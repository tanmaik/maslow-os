import AVFoundation
import SwiftUI
import UIKit

// The machine's browser as it arrives on the View socket: one binary frame
// is one H.264 access unit in Annex B form, its first byte 1 for a key
// frame. The parameter sets in a key frame describe the stream, the rest
// of each unit is handed to VideoToolbox through a sample-buffer layer,
// which fills the pane it is shown in.
@MainActor final class Picture {
  // The layer itself as a view, so the picture is drawn where it is put.
  final class Pane: UIView {
    override class var layerClass: AnyClass { AVSampleBufferDisplayLayer.self }
    var display: AVSampleBufferDisplayLayer { layer as! AVSampleBufferDisplayLayer }
  }

  let pane = Pane()
  // Said on screen when the picture cannot be decoded, and asked for
  // again: only a fresh stream begins on a key frame.
  var broken: ((String) -> Void)?

  private var parameters: (sps: Data, pps: Data)?
  private var format: CMFormatDescription?
  private var wantKey = true

  init() {
    pane.display.videoGravity = .resizeAspect
    pane.backgroundColor = .black
  }

  // Waits for the next whole picture: a stream at a new size, a socket
  // that came back, or a decoder that failed.
  func restart() {
    wantKey = true
    format = nil
    parameters = nil
    pane.display.sampleBufferRenderer.flush(removingDisplayedImage: true, completionHandler: nil)
  }

  // One access unit onto the screen. Anything before the first key frame
  // is dropped, since a delta frame rests on pictures that never came.
  func feed(_ frame: Data) {
    guard let first = frame.first, frame.count > 1 else { return }
    if wantKey && first != 1 { return }
    var payload = Data()
    for unit in Self.units(in: frame.dropFirst()) {
      guard let header = unit.first else { continue }
      switch header & 0x1f {
      case 7: parameters = (Data(unit), parameters?.pps ?? Data()); format = nil
      case 8: parameters = (parameters?.sps ?? Data(), Data(unit)); format = nil
      case 9, 12: break
      default:
        var length = UInt32(unit.count).bigEndian
        withUnsafeBytes(of: &length) { payload.append(contentsOf: $0) }
        payload.append(contentsOf: unit)
      }
    }
    guard !payload.isEmpty, let described = describe() else { return }
    wantKey = false
    enqueue(payload, described)
  }

  // The stream's shape, from the parameter sets the encoder repeats with
  // every key frame.
  private func describe() -> CMFormatDescription? {
    if let format { return format }
    guard let parameters, !parameters.sps.isEmpty, !parameters.pps.isEmpty else { return nil }
    var made: CMFormatDescription?
    let status = parameters.sps.withUnsafeBytes { sps in
      parameters.pps.withUnsafeBytes { pps in
        var sets = [
          sps.baseAddress!.assumingMemoryBound(to: UInt8.self),
          pps.baseAddress!.assumingMemoryBound(to: UInt8.self),
        ]
        var sizes = [sps.count, pps.count]
        return CMVideoFormatDescriptionCreateFromH264ParameterSets(
          allocator: kCFAllocatorDefault, parameterSetCount: 2, parameterSetPointers: &sets,
          parameterSetSizes: &sizes, nalUnitHeaderLength: 4, formatDescriptionOut: &made)
      }
    }
    guard status == noErr, let made else {
      broken?("The picture's own description could not be read.")
      return nil
    }
    format = made
    return made
  }

  private func enqueue(_ payload: Data, _ format: CMFormatDescription) {
    let renderer = pane.display.sampleBufferRenderer
    if renderer.requiresFlushToResumeDecoding || renderer.status == .failed {
      broken?(renderer.error?.localizedDescription ?? "The picture stopped decoding.")
      return restart()
    }
    do {
      let block = try CMBlockBuffer(length: payload.count)
      try payload.withUnsafeBytes { try block.replaceDataBytes(with: $0) }
      let sample = try CMSampleBuffer(
        dataBuffer: block, formatDescription: format, numSamples: 1,
        sampleTimings: [CMSampleTimingInfo(duration: .invalid, presentationTimeStamp: .invalid, decodeTimeStamp: .invalid)],
        sampleSizes: [payload.count])
      sample.sampleAttachments[0][.displayImmediately] = true
      renderer.enqueue(sample)
    } catch {
      broken?("This frame could not be decoded: \(error.localizedDescription)")
      restart()
    }
  }

  // The units of an Annex B access unit, without their start codes.
  private static func units(in frame: Data) -> [Data] {
    let bytes = [UInt8](frame)
    var starts: [(at: Int, after: Int)] = []
    var i = 0
    while i + 2 < bytes.count {
      if bytes[i] == 0 && bytes[i + 1] == 0 && bytes[i + 2] == 1 {
        starts.append((i, i + 3))
        i += 3
      } else {
        i += 1
      }
    }
    return starts.indices.map { n in
      let end = n + 1 < starts.count ? starts[n + 1].at : bytes.count
      // A four-byte start code's leading zero belongs to it, not to the
      // unit before it.
      let last = n + 1 == starts.count
      let stop = !last && end > starts[n].after && bytes[end - 1] == 0 ? end - 1 : end
      return Data(bytes[starts[n].after..<stop])
    }
  }
}

// The picture in a SwiftUI pane, edge to edge.
struct PictureView: UIViewRepresentable {
  let picture: Picture

  func makeUIView(context: Context) -> UIView { picture.pane }
  func updateUIView(_ view: UIView, context: Context) {}
}
