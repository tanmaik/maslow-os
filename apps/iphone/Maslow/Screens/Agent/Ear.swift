import AVFoundation
import Foundation
import Observation

// What the phone hears while the person holds the button: the words as
// they are heard, how loud the voice is, and a sentence on screen when it
// cannot hear. Speech becomes text at Deepgram: our server mints a token
// good for a minute and the phone streams its microphone there directly,
// so the sound never passes through us. Without the key the server says
// this copy cannot hear, and that is what the button says.

// One buffer of the microphone, handed off the audio thread.
private nonisolated struct Said: @unchecked Sendable {
  let buffer: AVAudioPCMBuffer
}

// How much of the voice waits while the line to Deepgram is still opening,
// in buffers: several seconds, so the first word of a hold is never the one
// that is lost.
private let waiting = 100

private nonisolated struct Unheard: LocalizedError {
  let said: String
  var errorDescription: String? { said }
}

// Where the voice goes and what lets it in, for this one hold.
private nonisolated struct Ticket: Decodable, Sendable {
  let url: String
  let token: String
}

// One word back from Deepgram: what it has heard so far, marked once it
// has settled.
private nonisolated struct Word: Decodable {
  struct Channel: Decodable {
    struct Alternative: Decodable { let transcript: String? }
    let alternatives: [Alternative]
  }

  let type: String
  let settled: Bool?
  let channel: Channel?

  enum CodingKeys: String, CodingKey {
    case type
    case settled = "is_final"
    case channel
  }
}

@Observable
final class Ear {
  // The session the words are minted under: the one the app holds now.
  var api: API?
  private(set) var on = false
  // Everything heard so far in this hold, the tail as it is still being
  // guessed at.
  private(set) var heard = ""
  // How loud the voice is now, nothing to one, which the button breathes
  // with.
  private(set) var level: Double = 0
  private(set) var why: String?

  private let engine = AVAudioEngine()
  private var socket: URLSessionWebSocketTask?
  private var reading: Task<Void, Never>?
  private var pumping: Task<Void, Never>?
  private var settled = ""
  private var settling = ""
  // What was said before the line opened, sent the moment it does.
  private var held: [Data] = []
  private var done = false
  // A ticket minted ahead of the hold, so the line opens the moment the
  // thumb lands rather than after a round trip to our server.
  private var ready: (ticket: Ticket, at: ContinuousClock.Instant)?
  private var warming: Task<Void, Never>?
  private var awake = false

  // Gets ready while the Agent is in view: the microphone allowed and its
  // session held open for as long as the Agent is, and a fresh ticket kept
  // in hand, minted again as each one nears the end of its minute. The
  // engine itself waits for the hold, since it has no valid input to
  // prepare on before the session is live.
  func warm() {
    warming?.cancel()
    warming = Task {
      guard await AVAudioApplication.requestRecordPermission() else { return }
      // The Agent may have gone while the phone asked; then nothing opens.
      guard !Task.isCancelled else { return }
      if !awake, (try? awaken()) != nil { awake = true }
      while !Task.isCancelled {
        if let t = try? await ticket(fresh: true) { ready = (t, .now) }
        try? await Task.sleep(for: .seconds(40))
      }
    }
  }

  // The Agent out of view: the tickets stop, and the microphone's session
  // is given back so nothing else on the phone stays interrupted.
  func rest() {
    warming?.cancel()
    warming = nil
    if !on { release() }
  }

  // The microphone open and the words arriving, or a sentence saying why
  // not.
  func start() async {
    guard !on else { return }
    why = nil
    heard = ""
    settled = ""
    settling = ""
    level = 0
    held = []
    done = false
    guard await AVAudioApplication.requestRecordPermission() else {
      why = "Maslow needs the microphone to hear you; turn it on in Settings."
      return
    }
    do {
      // The microphone first, so what is said while the line is being
      // opened is heard too.
      if !awake { try awaken(); awake = true }
      try pump()
      on = true
      let ticket = try await ticket(fresh: false)
      // Let go before the line opened: nothing was said.
      guard on else { return }
      try open(ticket)
    } catch {
      why = error.localizedDescription
      await quiet()
    }
  }

  // The hold let go: everything heard, once the last words have settled.
  func stop() async -> String {
    guard on else { return "" }
    on = false
    engine.inputNode.removeTap(onBus: 0)
    engine.stop()
    pumping?.cancel()
    if let socket {
      try? await socket.send(.string(#"{"type":"CloseStream"}"#))
      // Deepgram answers the end of the audio with the last of the words;
      // they are worth a moment's wait and no more.
      for _ in 0..<16 where !done {
        try? await Task.sleep(for: .milliseconds(50))
      }
    }
    let said = words()
    await quiet()
    return said
  }

  // The thumb slid off: nothing said, nothing kept.
  func cancel() {
    Task { await quiet() }
  }

  private func quiet() async {
    on = false
    level = 0
    heard = ""
    settled = ""
    settling = ""
    held = []
    engine.inputNode.removeTap(onBus: 0)
    if engine.isRunning { engine.stop() }
    pumping?.cancel()
    pumping = nil
    reading?.cancel()
    reading = nil
    socket?.cancel(with: .goingAway, reason: nil)
    socket = nil
    // While the Agent is in view the session stays open for the next hold;
    // otherwise this hold was the last use of it.
    if warming == nil { release() }
  }

  private func awaken() throws {
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.record, mode: .measurement)
    try session.setActive(true, options: .notifyOthersOnDeactivation)
  }

  // The session given back, so the next hold opens it anew.
  private func release() {
    guard awake else { return }
    awake = false
    try? AVAudioSession.sharedInstance().setActive(
      false, options: .notifyOthersOnDeactivation)
  }

  // A token of this person's, minted by our server for one hold, or the
  // server's own sentence saying nothing can be heard. The one kept in
  // hand serves while it is under a minute old.
  private func ticket(fresh: Bool) async throws -> Ticket {
    if !fresh, let ready, ready.at.duration(to: .now) < .seconds(50) {
      self.ready = nil
      return ready.ticket
    }
    guard let api else { throw Unheard(said: "Sign in first.") }
    var request = URLRequest(url: api.server.appending(path: "/speech/ticket"))
    request.httpMethod = "POST"
    if let token = api.token {
      request.setValue("Bearer \(token)", forHTTPHeaderField: "authorization")
    }
    let data: Data
    let response: URLResponse
    do {
      (data, response) = try await URLSession.shared.data(for: request)
    } catch {
      throw Unheard(said: "Maslow can't be reached.")
    }
    guard (response as? HTTPURLResponse)?.statusCode == 200 else {
      let said = String(data: data, encoding: .utf8)?
        .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
      throw Unheard(said: said.isEmpty ? "Nothing can be heard right now." : said)
    }
    return try JSONDecoder().decode(Ticket.self, from: data)
  }

  // The line to Deepgram, opened on the token and read until it closes.
  private func open(_ ticket: Ticket) throws {
    guard let url = URL(string: ticket.url) else {
      throw Unheard(said: "Nothing can be heard right now.")
    }
    var request = URLRequest(url: url)
    request.setValue("Bearer \(ticket.token)", forHTTPHeaderField: "authorization")
    let socket = URLSession.shared.webSocketTask(with: request)
    socket.resume()
    self.socket = socket
    reading = Task { [weak self] in await self?.listen(socket) }
  }

  private func listen(_ socket: URLSessionWebSocketTask) async {
    while true {
      do {
        if case .string(let line) = try await socket.receive() { take(line) }
      } catch {
        done = true
        guard on else { return }
        why = "The line to hear you dropped."
        await quiet()
        return
      }
    }
  }

  // The microphone itself, cut to the 16 kHz the ear is listening for and
  // sent on as it is heard.
  private func pump() throws {
    let input = engine.inputNode
    let source = input.outputFormat(forBus: 0)
    guard source.sampleRate > 0 else {
      throw Unheard(said: "This phone's microphone is not available right now.")
    }
    guard
      let wire = AVAudioFormat(
        commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true),
      let converter = AVAudioConverter(from: source, to: wire)
    else {
      throw Unheard(said: "This phone's microphone cannot be heard.")
    }
    let (stream, sink) = AsyncStream.makeStream(of: Said.self)
    input.installTap(onBus: 0, bufferSize: 4096, format: source) { @Sendable buffer, _ in
      sink.yield(Said(buffer: buffer))
    }
    engine.prepare()
    try engine.start()
    pumping = Task { [weak self] in
      for await said in stream {
        guard let self else { return }
        level = loudness(said.buffer)
        guard let pcm = convert(said.buffer, to: wire, with: converter) else { continue }
        guard let socket else {
          if held.count < waiting { held.append(pcm) }
          continue
        }
        let backlog = held
        held = []
        for waited in backlog { try? await socket.send(.data(waited)) }
        try? await socket.send(.data(pcm))
      }
    }
  }

  // One more piece of what was heard: a phrase that has settled is kept, a
  // guess at the tail stands in for itself until the next guess.
  private func take(_ line: String) {
    guard let data = line.data(using: .utf8),
      let word = try? JSONDecoder().decode(Word.self, from: data)
    else { return }
    // The last thing Deepgram says is what it made of the whole hold.
    if word.type == "Metadata" { done = true }
    guard word.type == "Results" else { return }
    let said = (word.channel?.alternatives.first?.transcript ?? "")
      .trimmingCharacters(in: .whitespacesAndNewlines)
    if word.settled == true {
      if !said.isEmpty { settled += settled.isEmpty ? said : " " + said }
      settling = ""
    } else {
      settling = said
    }
    heard = words()
  }

  private func words() -> String {
    [settled, settling]
      .filter { !$0.isEmpty }
      .joined(separator: " ")
      .trimmingCharacters(in: .whitespacesAndNewlines)
  }
}

// How loud a buffer is, nothing to one, on the scale a voice lives in.
private func loudness(_ buffer: AVAudioPCMBuffer) -> Double {
  guard let samples = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return 0 }
  let count = Int(buffer.frameLength)
  var sum: Float = 0
  for i in 0..<count { sum += samples[i] * samples[i] }
  let rms = (sum / Float(count)).squareRoot()
  let db = 20 * log10(max(rms, 1e-7))
  return min(1, max(0, Double(db + 50) / 50))
}

// The microphone's buffer as the signed 16-bit samples the ear is listening
// for.
private func convert(
  _ buffer: AVAudioPCMBuffer, to format: AVAudioFormat, with converter: AVAudioConverter
) -> Data? {
  let ratio = format.sampleRate / buffer.format.sampleRate
  let room = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 1024
  guard let out = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: room) else { return nil }
  var given = false
  var failed: NSError?
  converter.convert(to: out, error: &failed) { _, status in
    if given {
      status.pointee = .noDataNow
      return nil
    }
    given = true
    status.pointee = .haveData
    return buffer
  }
  guard failed == nil, out.frameLength > 0, let samples = out.int16ChannelData else { return nil }
  return Data(bytes: samples[0], count: Int(out.frameLength) * MemoryLayout<Int16>.size)
}
