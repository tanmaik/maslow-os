import SwiftUI

// The machine's browser in hand: its picture live, the person's taps,
// drags, scrolls and typed keys on it, its tabs, and the words they pick
// carried into the phone's own clipboard. The machine draws the page at
// the size of this pane, so the picture fills it edge to edge.
struct BrowserView: View {
  @Environment(Session.self) private var session
  @Environment(\.scenePhase) private var scenePhase
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var browser: Browser?
  @State private var tabs = false
  @State private var typing = false
  @State private var typed = ""
  @FocusState private var keyboard: Bool

  var body: some View {
    Group {
      if let browser {
        Live(
          browser: browser, tabs: $tabs, typing: $typing, typed: $typed, keyboard: $keyboard,
          reduceMotion: reduceMotion)
      } else {
        ProgressView()
      }
    }
    .navigationTitle("Browser")
    .navigationBarTitleDisplayMode(.inline)
    .task {
      let made = browser ?? Browser(api: session.api)
      browser = made
      made.start()
    }
    .onChange(of: scenePhase) { _, now in
      browser?.watch(now == .active)
    }
  }

  // The page and everything that acts on it, once there is a browser to
  // act on.
  private struct Live: View {
    let browser: Browser
    @Binding var tabs: Bool
    @Binding var typing: Bool
    @Binding var typed: String
    @FocusState.Binding var keyboard: Bool
    let reduceMotion: Bool
    // Where a press began and how far the finger has carried since, so a
    // press that stays is a tap and one that moves is a scroll.
    @State private var began: CGPoint?
    @State private var carried: CGFloat = 0
    @State private var scrolled: CGFloat = 0
    @State private var selecting = false
    @State private var pane = CGSize.zero

    var body: some View {
      page
        .overlay(alignment: .bottom) { status }
        .safeAreaInset(edge: .bottom) { if typing { keys } }
        .toolbar { bar }
        .sheet(isPresented: $tabs) { Tabs(browser: browser) }
        .sensoryFeedback(trigger: browser.note) { _, note in
          guard let note else { return nil }
          return note.ok ? .success : .error
        }
        .sensoryFeedback(.selection, trigger: selecting) { _, now in now }
    }

    // The picture, at the size of the pane, with the person's hands on it.
    private var page: some View {
      PictureView(picture: browser.picture)
        .ignoresSafeArea(.container, edges: .bottom)
        .onGeometryChange(for: CGSize.self) { $0.size } action: { size in
          pane = size
          browser.settle(pane: size)
        }
        .gesture(hand)
        .simultaneousGesture(
          LongPressGesture(minimumDuration: 0.4).onEnded { _ in selecting = true }
        )
        .overlay { away }
        .accessibilityLabel("The page on your computer's browser")
    }

    // A press and a release in one place is a tap; a finger that carries
    // scrolls the page; a press held first selects the words it crosses.
    private var hand: some Gesture {
      DragGesture(minimumDistance: 0)
        .onChanged { at in
          let on = browser.at(at.location, in: pane)
          if began == nil {
            began = on
            carried = 0
            scrolled = 0
            browser.move(on)
          }
          carried = max(carried, abs(at.translation.width) + abs(at.translation.height))
          guard !selecting else { return }
          // The page under the finger moves with it, a wheel's worth at a
          // time, so a long flick is a handful of words and not hundreds.
          let want = -(at.translation.height - scrolled)
          if abs(want) >= 8 {
            scrolled = at.translation.height
            browser.scroll(on, by: browser.over(want, in: pane))
          }
        }
        .onEnded { at in
          let from = began ?? browser.at(at.startLocation, in: pane)
          let to = browser.at(at.location, in: pane)
          if selecting {
            browser.select(from: from, to: to)
          } else if carried < 10 {
            browser.tap(to)
          }
          began = nil
          selecting = false
          browser.leave()
        }
    }

    // Nothing to look at: the machine's browser is closed, or its door is
    // not answering, each said in a sentence.
    @ViewBuilder private var away: some View {
      switch browser.phase {
      case .asking:
        ProgressView("Looking for your computer's browser…")
          .frame(maxWidth: .infinity, maxHeight: .infinity)
          .background(.background)
      case .closed:
        ContentUnavailableView(
          "No page open", systemImage: "globe",
          description: Text("Type an address above, or let your agent open one."))
          .frame(maxWidth: .infinity, maxHeight: .infinity)
          .background(.background)
      case .failed(let why):
        ContentUnavailableView {
          Label("Can't reach your computer's browser", systemImage: "wifi.exclamationmark")
        } description: {
          Text(why)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.background)
      case .open:
        EmptyView()
      }
    }

    // What came of the last hand, and what a page asking for words wants
    // the person to know.
    @ViewBuilder private var status: some View {
      if let note = browser.note {
        Text(note.text)
          .font(.footnote)
          .foregroundStyle(note.ok ? .secondary : Color.red)
          .padding(.horizontal, 12)
          .padding(.vertical, 8)
          .frame(maxWidth: .infinity, alignment: .leading)
          .background(.background.secondary)
          .transition(reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
          .onTapGesture { browser.note = nil }
      } else if browser.cursor == "text" {
        Text("Press and hold, then drag across the words.")
          .font(.footnote)
          .foregroundStyle(.secondary)
          .padding(.vertical, 8)
      }
    }

    // What the person types goes into the page as they type it, and Return
    // is Return.
    private var keys: some View {
      HStack {
        TextField("Type into the page", text: $typed)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .submitLabel(.return)
          .focused($keyboard)
          .onChange(of: typed) { _, now in browser.typed(now) }
          .onSubmit {
            browser.press("Enter")
            browser.clearTyping()
            typed = ""
          }
        Button("Done") {
          typing = false
          browser.clearTyping()
          typed = ""
        }
      }
      .padding(.horizontal)
      .padding(.vertical, 8)
    }

    // Everything the page is steered by stands in the bar at the top: the
    // bottom of a phone belongs to the tabs of the app itself.
    @ToolbarContentBuilder private var bar: some ToolbarContent {
      ToolbarItem(placement: .principal) { Address(browser: browser) }
      ToolbarItem(placement: .topBarTrailing) {
        Button("Tabs", systemImage: "square.on.square") { tabs = true }
      }
      ToolbarItem(placement: .topBarTrailing) {
        Menu("More", systemImage: "ellipsis") {
          Button("Back", systemImage: "chevron.left") { browser.back() }
          Button("Forward", systemImage: "chevron.right") { browser.forward() }
          Button("Reload", systemImage: "arrow.clockwise") { browser.reload() }
          Divider()
          Button("Type into the page", systemImage: "keyboard") {
            typing = true
            keyboard = true
          }
          Button("Copy what is selected", systemImage: "doc.on.doc") { browser.copy() }
          Button("New tab", systemImage: "plus") { browser.newTab() }
        }
      }
    }
  }

  // Where the browser is, and where it is going.
  private struct Address: View {
    let browser: Browser
    @FocusState private var editing: Bool

    var body: some View {
      TextField("An address", text: Binding(get: { browser.address }, set: { browser.address = $0 }))
        .textFieldStyle(.plain)
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .keyboardType(.URL)
        .submitLabel(.go)
        .focused($editing)
        .onChange(of: editing) { _, now in browser.typing = now }
        .onSubmit {
          browser.go(to: browser.address)
          editing = false
        }
        .frame(maxWidth: .infinity)
    }
  }

  // The browser's tabs: the one shown, the one to switch to, the ones to
  // close, and room for one more.
  private struct Tabs: View {
    let browser: Browser
    @Environment(\.dismiss) private var dismiss

    var body: some View {
      NavigationStack {
        List {
          if browser.tabs.isEmpty {
            ContentUnavailableView(
              "No tabs", systemImage: "square.on.square",
              description: Text("Open one and the machine's browser opens with it."))
          }
          ForEach(browser.tabs) { tab in
            Button {
              browser.show(tab: tab.id)
              dismiss()
            } label: {
              LabeledContent {
                if tab.id == browser.current {
                  Image(systemName: "checkmark").foregroundStyle(.tint)
                }
              } label: {
                Text(tab.name).lineLimit(1)
                if !tab.url.isEmpty, tab.url != "about:blank" {
                  Text(tab.url).lineLimit(1)
                }
              }
            }
            .swipeActions {
              Button("Close", systemImage: "xmark", role: .destructive) {
                browser.close(tab: tab.id)
              }
            }
          }
        }
        .navigationTitle("Tabs")
        .toolbar {
          ToolbarItem(placement: .topBarTrailing) {
            Button("New tab", systemImage: "plus") {
              browser.newTab()
              dismiss()
            }
          }
        }
      }
      .presentationDetents([.medium, .large])
      .presentationDragIndicator(.visible)
    }
  }
}
