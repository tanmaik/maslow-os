import SwiftUI

// The way in: the warm ground, darkened, with the clock and the date over it
// and one column in the middle. It asks for an address, then the code, and
// a person in more than one org says which one before the desk.
struct LockScreen: View {
  @Environment(Session.self) private var session
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  private enum Step: Equatable {
    case address
    case code(String)
    case org(API.Opened)
  }

  @State private var step = Step.address
  @State private var email = ""
  @State private var code = ""
  @State private var busy = false
  @State private var said: String?
  @State private var wrong = 0
  @State private var granted = 0
  @State private var seeded: [API.Seeded] = []
  @State private var server = Session.defaultServer.absoluteString
  @FocusState private var focused: Bool

  var body: some View {
    ZStack {
      Ground()
      ViewThatFits(in: .vertical) {
        page
        ScrollView { page }.scrollDismissesKeyboard(.interactively)
      }
    }
    .task { await loadSeeded() }
    .sensoryFeedback(.error, trigger: wrong)
    .sensoryFeedback(.success, trigger: granted)
  }

  // The clock over the column: centred while it fits, scrolling when a large
  // type size or the keyboard leaves no room.
  private var page: some View {
    VStack(spacing: 24) {
      Clock().padding(.top, 72)
      Spacer(minLength: 0)
      column.frame(maxWidth: 360)
      Spacer(minLength: 0)
      Spacer(minLength: 0)
    }
    .frame(maxWidth: .infinity)
    .padding(.horizontal, 24)
  }

  // Every custom glass view on this screen shares one container: glass can
  // not sample other glass.
  @ViewBuilder private var column: some View {
    GlassEffectContainer(spacing: 0) {
      VStack(spacing: 16) {
        switch step {
        case .address:
          TextField("Email", text: $email)
            .textContentType(.emailAddress)
            .keyboardType(.emailAddress)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .submitLabel(.go)
            .focused($focused)
            .onSubmit { Task { await sendCode() } }
            .field()
          Button("Continue") { Task { await sendCode() } }
            .buttonStyle(.glassProminent)
            .controlSize(.large)
            .buttonSizing(.flexible)
            .disabled(busy || !email.contains("@"))
        case .code(let address):
          VStack(spacing: 6) {
            Text("Enter the code sent to").foregroundStyle(.secondary)
            Text(address).fontWeight(.medium)
          }
          .font(.subheadline)
          .multilineTextAlignment(.center)
          CodeBoxes(code: $code, focused: $focused)
            .onChange(of: code) { _, now in
              if now.count == 6 { Task { await redeem(address) } }
            }
          Button("Use another address") {
            withAnimation(motion) {
              step = .address
              code = ""
              said = nil
            }
          }
          .font(.subheadline)
          .tint(.secondary)
          .frame(minHeight: 44)
        case .org(let opened):
          Text("Which org are you in?")
            .font(.subheadline)
            .foregroundStyle(.secondary)
          ForEach(opened.orgs) { org in
            let button = Button(org.name) { Task { await pick(org, from: opened) } }
              .controlSize(.large)
              .buttonSizing(.flexible)
            if org.current {
              button.buttonStyle(.glassProminent)
            } else {
              button.buttonStyle(.glass)
            }
          }
        }
        if let said {
          Text(said)
            .font(.footnote)
            .foregroundStyle(.red)
            .multilineTextAlignment(.center)
            .transition(.opacity)
        }
        if busy { ProgressView() }
        if step == .address, !seeded.isEmpty { development }
      }
      .animation(motion, value: step)
      .animation(.smooth(duration: 0.2), value: said)
    }
  }

  // The seeded people, under a quiet divider, and where the phone points:
  // outside production only.
  private var development: some View {
    VStack(spacing: 10) {
      HStack(spacing: 8) {
        rule
        Text("Development").font(.caption2).foregroundStyle(.tertiary)
        rule
      }
      .padding(.top, 24)
      ForEach(seeded) { person in
        Button {
          Task { await signIn(seeded: person) }
        } label: {
          LabeledContent(person.name) { Text(person.org) }
            .font(.subheadline)
            .padding(.horizontal, 16)
            .frame(minHeight: 44)
        }
        .buttonStyle(.glass)
      }
      #if DEBUG
        TextField("Server", text: $server)
          .font(.caption.monospaced())
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .keyboardType(.URL)
          .onSubmit { pointServer() }
          .field()
      #endif
    }
  }

  private var rule: some View {
    Color(.separator).frame(height: 1)
  }

  // Brief, and briefer for anyone who asked for less motion.
  private var motion: Animation {
    reduceMotion ? .smooth(duration: 0.2) : .snappy(duration: 0.3)
  }

  private func pointServer() {
    guard let url = URL(string: server), url.host() != nil else { return }
    session.server = url
    UserDefaults.standard.set(url, forKey: "server")
    Task { await loadSeeded() }
  }

  private func loadSeeded() async {
    seeded = (try? await session.api.seeded()) ?? []
  }

  private func run(_ work: () async throws -> Void) async {
    busy = true
    said = nil
    defer { busy = false }
    do { try await work() } catch { said = error.localizedDescription }
  }

  private func sendCode() async {
    let address = email.trimmingCharacters(in: .whitespaces).lowercased()
    guard address.contains("@") else { return }
    await run {
      try await session.api.sendCode(to: address)
      withAnimation(motion) { step = .code(address) }
      focused = true
    }
  }

  private func redeem(_ address: String) async {
    await run {
      do {
        land(try await session.api.redeem(email: address, code: code))
      } catch {
        code = ""
        wrong += 1
        throw error
      }
    }
  }

  private func signIn(seeded person: API.Seeded) async {
    await run { land(try await session.api.signIn(seeded: person.userId)) }
  }

  private func pick(_ org: Session.Org, from opened: API.Opened) async {
    if org.current { return session.open(opened) }
    await run {
      // The session moves to the org picked; the one just opened ends.
      session.open(opened)
      let moved = try await session.api.switchOrg(to: org.userId)
      session.open(moved)
    }
  }

  // Signed in: straight to the desk, unless there are orgs to choose from.
  private func land(_ answer: API.Opened) {
    granted += 1
    if answer.orgs.count > 1 {
      withAnimation(motion) { step = .org(answer) }
    } else {
      session.open(answer)
    }
  }
}

// Six boxes; the last digit sends. One hidden field takes the typing, so
// the keyboard's code autofill lands in it.
private struct CodeBoxes: View {
  @Binding var code: String
  var focused: FocusState<Bool>.Binding

  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.colorSchemeContrast) private var contrast
  @ScaledMetric(relativeTo: .title) private var height = 56.0

  private let box = RoundedRectangle(cornerRadius: 12, style: .continuous)

  var body: some View {
    ZStack {
      TextField("Code", text: $code)
        .keyboardType(.numberPad)
        .textContentType(.oneTimeCode)
        .focused(focused)
        .opacity(0.01)
        .onChange(of: code) { _, now in
          let digits = now.filter(\.isNumber).prefix(6)
          if String(digits) != now { code = String(digits) }
        }
      HStack(spacing: 8) {
        ForEach(0..<6, id: \.self) { i in
          Text(digit(i))
            .font(.title.monospacedDigit().weight(.medium))
            .frame(maxWidth: .infinity)
            .frame(height: height)
            .glassEffect(.regular, in: box)
            .overlay { box.strokeBorder(edge(i), lineWidth: contrast == .increased ? 2.5 : 1.5) }
            .contentTransition(reduceMotion ? .identity : .numericText())
        }
      }
      .animation(.snappy(duration: 0.15), value: code)
      .contentShape(.rect)
      .onTapGesture { focused.wrappedValue = true }
      .accessibilityHidden(true)
    }
    .onAppear { focused.wrappedValue = true }
  }

  private func digit(_ i: Int) -> String {
    code.count > i ? String(Array(code)[i]) : ""
  }

  // The box waiting for the next digit is marked; under Increase Contrast
  // every box wears an edge of its own.
  private func edge(_ i: Int) -> Color {
    if code.count == i { .accentColor } else if contrast == .increased { .primary } else { .clear }
  }
}

// The clock and the date, as a lock screen wears them. The one fixed size in
// the app: display type, scaled with Dynamic Type from Large Title.
private struct Clock: View {
  @ScaledMetric(relativeTo: .largeTitle) private var size = 72.0

  var body: some View {
    TimelineView(.everyMinute) { context in
      VStack(spacing: 2) {
        Text(context.date, format: .dateTime.weekday(.wide).month(.wide).day())
          .font(.headline)
          .foregroundStyle(.secondary)
        Text(context.date, format: .dateTime.hour().minute())
          .font(.system(size: size, weight: .regular, design: .rounded))
          .monospacedDigit()
      }
    }
  }
}

// The bare warm ground the desk lies on, darkened.
struct Ground: View {
  var body: some View {
    ZStack {
      Color(red: 0.08, green: 0.075, blue: 0.07)
      RadialGradient(
        colors: [Color.accentColor.opacity(0.07), .clear],
        center: .init(x: 0.3, y: 0.2), startRadius: 0, endRadius: 520)
      RadialGradient(
        colors: [Color.white.opacity(0.05), .clear],
        center: .init(x: 0.8, y: 0.9), startRadius: 0, endRadius: 420)
    }
    .ignoresSafeArea()
  }
}

private extension View {
  // A field on the lock screen: glass, one line, a thumb's height.
  func field() -> some View {
    padding(.horizontal, 20)
      .frame(minHeight: 44)
      .glassEffect()
  }
}
