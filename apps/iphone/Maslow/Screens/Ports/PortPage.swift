import SwiftUI
import WebKit

// A port as a page framed under its own bar: our door mints a ticket for
// that port alone and points at the machine, so the page opens or is
// nothing at all. Pulled down it is minted and loaded again, and the
// ticket is renewed before its hour is up.
struct PortPage: View {
  let title: String
  let href: String

  @Environment(Session.self) private var session
  @State private var loaded = Loaded<URL>.reading
  @State private var refusals = 0

  var body: some View {
    Group {
      switch loaded {
      case .reading:
        ProgressView()
      case .failed(let said):
        Failed(said: said) { await mint() }
      case .ready(let url):
        PortWeb(url: url, pull: { Task { await mint() } }) { said in
          loaded = .failed(said)
          refusals += 1
        }
      }
    }
    .navigationTitle(title)
    .toolbarTitleDisplayMode(.inline)
    .sensoryFeedback(.error, trigger: refusals)
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        Button("Reload", systemImage: "arrow.clockwise") { Task { await mint() } }
      }
    }
    .task {
      // A ticket for a port lasts an hour; the page mints another before
      // then, so a page left open keeps working.
      while !Task.isCancelled {
        await mint()
        try? await Task.sleep(for: .seconds(50 * 60))
      }
    }
  }

  private func mint() async {
    do {
      loaded = .ready(try await session.api.portLink(href))
    } catch API.Failure.signedOut {
      session.close()
    } catch {
      loaded = .failed(error.localizedDescription)
      refusals += 1
    }
  }
}

// The port's own page, as the machine serves it: a web view, pulled down
// to load it again, and any refusal to load said in words.
private struct PortWeb: UIViewRepresentable {
  let url: URL
  let pull: () -> Void
  let failed: (String) -> Void

  func makeUIView(context: UIViewRepresentableContext<PortWeb>) -> WKWebView {
    let web = WKWebView()
    web.navigationDelegate = context.coordinator
    web.allowsBackForwardNavigationGestures = true
    let refresh = UIRefreshControl()
    refresh.addTarget(context.coordinator, action: #selector(Coordinator.pulled), for: .valueChanged)
    web.scrollView.refreshControl = refresh
    context.coordinator.web = web
    return web
  }

  func updateUIView(_ web: WKWebView, context: UIViewRepresentableContext<PortWeb>) {
    context.coordinator.page = self
    if context.coordinator.showing != url {
      context.coordinator.showing = url
      web.load(URLRequest(url: url))
    }
  }

  func makeCoordinator() -> Coordinator { Coordinator(page: self) }

  final class Coordinator: NSObject, WKNavigationDelegate {
    var page: PortWeb
    var showing: URL?
    weak var web: WKWebView?

    init(page: PortWeb) { self.page = page }

    // A pull mints the address again and loads the page, whether or not
    // the address itself changed.
    @objc func pulled() {
      page.pull()
      web?.reload()
    }

    func webView(_ web: WKWebView, didFinish navigation: WKNavigation!) {
      web.scrollView.refreshControl?.endRefreshing()
    }

    func webView(_ web: WKWebView, didFail navigation: WKNavigation!, withError error: any Error) {
      web.scrollView.refreshControl?.endRefreshing()
      page.failed(error.localizedDescription)
    }

    func webView(
      _ web: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
      withError error: any Error
    ) {
      web.scrollView.refreshControl?.endRefreshing()
      page.failed(error.localizedDescription)
    }
  }
}
