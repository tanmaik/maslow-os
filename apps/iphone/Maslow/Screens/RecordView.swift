import SwiftUI

// A record, whole and writable: its title, when it happened and whose it
// is, the fields its type declares, what it says as markdown or as the
// text being typed, and every link touching it. A save names the last
// change it saw, so one that fell behind is refused rather than written
// over what landed since; while the page is open it watches the record and
// takes in what changed elsewhere.
struct RecordView: View {
  let id: String
  @Environment(Session.self) private var session
  @Environment(\.dynamicTypeSize) private var typeSize
  @ScaledMetric(relativeTo: .subheadline) private var chipHeight = 30.0
  @State private var loaded = Loaded<Whole>.reading
  @State private var seen = 0
  @State private var editing = false
  @State private var title = ""
  @State private var draft = ""
  @State private var values: [String: String] = [:]
  @State private var declared: [Property] = []
  @FocusState private var writing: Bool
  @State private var saving = false
  @State private var newer: Whole?
  @State private var removed = false
  @State private var linking = false
  @State private var sharing = false
  @State private var opened: String?
  @State private var said: String?
  @State private var saves = 0
  @State private var mishaps = 0

  var body: some View {
    Group {
      switch loaded {
      case .reading:
        ProgressView()
      case .failed(let said):
        Failed(said: said) { await load() }
      case .ready(let whole):
        page(whole)
      }
    }
    .navigationTitle(loaded.value?.record.type ?? "")
    .toolbarTitleDisplayMode(.inline)
    .toolbar { bar }
    .navigationBarBackButtonHidden(editing)
    .alert(
      "Couldn't save it", isPresented: .init(get: { said != nil }, set: { if !$0 { said = nil } })
    ) {
      Button("OK") { said = nil }
    } message: {
      Text(said ?? "")
    }
    .sheet(isPresented: .init(get: { newer != nil }, set: { if !$0 { newer = nil } })) {
      if let newer, let mine = loaded.value {
        NewerVersion(newer: newer, mine: mine, keep: { await keepMine() }, take: { take(newer) })
      }
    }
    .sheet(isPresented: $linking) {
      if let whole = loaded.value {
        LinkPicker(id: id, type: whole.record.type) { Task { await load() } }
      }
    }
    .sheet(isPresented: $sharing) {
      ShareSheet(record: id, what: "record") {}
    }
    .sensoryFeedback(.success, trigger: saves)
    .sensoryFeedback(.error, trigger: mishaps)
    .task(id: id) { await load() }
    .task(id: id) { await watch() }
  }

  // Editing is done or given up from the bar; everything else a record can
  // have done to it stands in one menu.
  @ToolbarContentBuilder private var bar: some ToolbarContent {
    if editing {
      ToolbarItem(placement: .cancellationAction) {
        Button("Cancel") { editing = false }
          .disabled(saving)
      }
      ToolbarItem(placement: .confirmationAction) {
        Button("Done") { Task { await save() } }
          .disabled(saving || title.trimmingCharacters(in: .whitespaces).isEmpty)
      }
    } else if let whole = loaded.value {
      ToolbarItem(placement: .primaryAction) {
        Menu("Actions", systemImage: "ellipsis") {
          if whole.record.access != "view" {
            Button("Edit", systemImage: "pencil") { edit(whole.record) }
            Button("Link", systemImage: "link") { linking = true }
          }
          if whole.record.access == "owner" {
            Button("Share", systemImage: "person.badge.plus") { sharing = true }
          }
          ShareLink(item: session.api.server.appending(path: "/brain/records/\(id)"))
          if whole.record.access == "owner" {
            Section {
              if removed {
                Button("Restore", systemImage: "arrow.uturn.backward") {
                  Task { await mark("restore") }
                }
              } else {
                Button("Remove", systemImage: "trash", role: .destructive) {
                  Task { await mark("remove") }
                }
              }
            }
          }
        }
      }
    }
  }

  private func page(_ whole: Whole) -> some View {
    let r = whole.record
    let fields = r.props.keys.sorted().filter { !(r.props[$0]?.text.isEmpty ?? true) }
    return List {
      if removed {
        Section {
          Label("Removed. It stands aside until you restore it.", systemImage: "trash")
            .foregroundStyle(.secondary)
        }
      }
      Section { header(r) }
      if editing, !declared.isEmpty {
        Section("Fields") {
          ForEach(declared, id: \.name) { p in
            FieldEntry(
              name: Field.said(p.name), datatype: p.datatype, options: p.options ?? [],
              value: value(p.name))
          }
        }
      } else if !editing, !fields.isEmpty {
        Section("Fields") {
          ForEach(fields, id: \.self) { name in
            LabeledContent(Field.said(name), value: r.props[name]?.text ?? "")
          }
        }
      }
      if editing {
        Section("Body") {
          TextEditor(text: $draft)
            .frame(minHeight: 240)
            .focused($writing)
        }
      } else if !r.body.isEmpty {
        Section { MarkdownView(r.body).plainRow() }
      }
      Section("Links") { links(whole.links) }
    }
    .listStyle(.insetGrouped)
    .navigationDestination(item: $opened) { RecordView(id: $0) }
    .textSelection(.enabled)
    .refreshable { await load() }
  }

  // The title, with when it last changed and whose it is under it.
  private func header(_ r: Record) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      if editing {
        TextField("Title", text: $title, axis: .vertical)
          .font(.title)
          .fontWeight(.bold)
          .padding(.bottom, 6)
          .overlay(alignment: .bottom) { Divider() }
      } else {
        Text(r.title.isEmpty ? "Untitled" : r.title)
          .font(.title)
          .fontWeight(.bold)
      }
      meta(r)
    }
    .padding(.vertical, 4)
    .plainRow()
  }

  // When it last changed and whose it is, side by side until the type is
  // large.
  @ViewBuilder private func meta(_ r: Record) -> some View {
    let layout =
      typeSize.isAccessibilitySize
      ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4))
      : AnyLayout(HStackLayout(spacing: 10))
    layout {
      Text(r.updatedAt, format: .dateTime.month().day().year().hour().minute())
      if let owner = r.owner { Text(owner) }
    }
    .font(.subheadline)
    .foregroundStyle(.secondary)
  }

  // The links grouped by their verb, out of the record before into it, and
  // the one that makes another.
  @ViewBuilder private func links(_ links: [Link]) -> some View {
    let groups = Dictionary(grouping: links) { Verb(out: $0.out, word: $0.verb) }
    ForEach(groups.keys.sorted(), id: \.self) { verb in
      VStack(alignment: .leading, spacing: 8) {
        Label(verb.said, systemImage: verb.out ? "arrow.forward" : "arrow.backward")
          .font(.subheadline)
          .foregroundStyle(.secondary)
          .accessibilityLabel(
            verb.out ? "\(verb.said), from this record" : "\(verb.said), to this record")
        FlowLayout(spacing: 8) {
          ForEach(groups[verb] ?? []) { chip($0) }
        }
      }
      .padding(.vertical, 4)
      .plainRow()
    }
    if loaded.value?.record.access != "view" {
      Button("Link another record", systemImage: "plus") { linking = true }
        .plainRow()
    }
  }

  // One link as a chip, which opens the record at its other end, and can be
  // taken away from where it stands.
  private func chip(_ link: Link) -> some View {
    Button { opened = link.record.id } label: {
      HStack(spacing: 6) {
        TypeDot(type: link.record.type)
        Text(link.record.title.isEmpty ? "Untitled" : link.record.title)
          .lineLimit(typeSize.isAccessibilitySize ? 3 : 1)
      }
      .font(.subheadline)
      .frame(minHeight: chipHeight)
    }
    .buttonStyle(.bordered)
    .buttonBorderShape(.capsule)
    .contextMenu {
      if loaded.value?.record.access != "view" {
        Button("Unlink", systemImage: "link.badge.plus", role: .destructive) {
          Task { await unlink(link) }
        }
      }
    }
  }

  private func edit(_ r: Record) {
    title = r.title
    draft = r.body
    values = r.props.mapValues(\.text)
    editing = true
    writing = true
    Task { await declare(r) }
  }

  private func value(_ name: String) -> Binding<String> {
    Binding(get: { values[name] ?? "" }, set: { values[name] = $0 })
  }

  // What the record's type declares, so editing enters each field the way
  // that kind of field is entered.
  private func declare(_ r: Record) async {
    let types = try? await session.api.vocabulary().types
    declared = types?.first { $0.name == r.type && $0.ownerId == r.ownerId }?.properties ?? []
  }

  private func load() async {
    do {
      let whole = try await session.api.record(id)
      loaded = .ready(whole)
      seen = (try? await session.api.lastChange(id)) ?? seen
    } catch API.Failure.signedOut {
      session.close()
    } catch {
      mishaps += 1
      if loaded.value == nil { loaded = .failed(error.localizedDescription) }
    }
  }

  // While the record is open it is read every three seconds: what changed
  // elsewhere is on screen within seconds, and what the person is typing is
  // never written over — a newer version waits for them to look at it.
  private func watch() async {
    while !Task.isCancelled {
      try? await Task.sleep(for: .seconds(3))
      guard !Task.isCancelled, let mine = loaded.value else { continue }
      guard let fresh = try? await session.api.record(id) else { continue }
      guard fresh.record.updatedAt != mine.record.updatedAt else { continue }
      if editing {
        newer = fresh
      } else {
        loaded = .ready(fresh)
        seen = (try? await session.api.lastChange(id)) ?? seen
      }
    }
  }

  private func save() async {
    let wanted = title.trimmingCharacters(in: .whitespaces)
    let props = loaded.value?.record.props ?? [:]
    let changed = values.filter { $0.value != (props[$0.key]?.text ?? "") }
    saving = true
    defer { saving = false }
    do {
      seen = try await session.api.edit(
        id, seen: seen, title: wanted, body: draft, values: changed)
      editing = false
      saves += 1
      await load()
    } catch Refusal.behind {
      newer = try? await session.api.record(id)
      mishaps += 1
    } catch Refusal.signedOut {
      session.close()
    } catch {
      said = error.localizedDescription
      mishaps += 1
    }
  }

  // The person's own version kept over the one that landed since: their
  // save is made again, this time naming the change they have now seen.
  private func keepMine() async {
    seen = (try? await session.api.lastChange(id)) ?? seen
    newer = nil
    await save()
  }

  // The newer version taken: what was typed here is given up.
  private func take(_ whole: Whole) {
    loaded = .ready(whole)
    editing = false
    newer = nil
    Task { seen = (try? await session.api.lastChange(id)) ?? seen }
  }

  private func mark(_ intent: String) async {
    do {
      try await session.api.mark(id, intent: intent)
      removed = intent == "remove"
      saves += 1
      await load()
    } catch Refusal.signedOut {
      session.close()
    } catch {
      said = error.localizedDescription
      mishaps += 1
    }
  }

  private func unlink(_ link: Link) async {
    do {
      try await session.api.unlink(id, edges: [link.id])
      saves += 1
      await load()
    } catch Refusal.signedOut {
      session.close()
    } catch {
      said = error.localizedDescription
      mishaps += 1
    }
  }
}

// The version that landed while the person was typing, beside what they
// were typing: they keep theirs or take the newer one.
private struct NewerVersion: View {
  let newer: Whole
  let mine: Whole
  let keep: () async -> Void
  let take: () -> Void
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      List {
        Section("The newer version") {
          Text(newer.record.title.isEmpty ? "Untitled" : newer.record.title)
            .font(.headline)
          MarkdownView(newer.record.body)
        }
        Section("What you have open") {
          Text(mine.record.title.isEmpty ? "Untitled" : mine.record.title)
            .font(.headline)
          MarkdownView(mine.record.body)
        }
      }
      .navigationTitle("Changed elsewhere")
      .toolbarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Take theirs") {
            take()
            dismiss()
          }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button("Keep mine") {
            Task { await keep() }
            dismiss()
          }
        }
      }
    }
  }
}

// A verb as the page groups by it: the word, and which way the link points.
private struct Verb: Hashable, Comparable {
  let out: Bool
  let word: String

  var said: String { word.replacingOccurrences(of: "_", with: " ") }

  static func < (a: Verb, b: Verb) -> Bool {
    (a.out ? 0 : 1, a.word) < (b.out ? 0 : 1, b.word)
  }
}

extension View {
  // A row carrying plain content rather than a grouped card.
  fileprivate func plainRow() -> some View {
    listRowBackground(Color.clear)
      .listRowSeparator(.hidden)
  }
}

// Chips laid in rows, wrapping as they fill the width.
struct FlowLayout: Layout {
  var spacing: CGFloat = 8

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let rows = rows(width: proposal.width ?? .infinity, subviews: subviews)
    let width = rows.map { row in
      row.map(\.width).reduce(0, +) + spacing * CGFloat(max(row.count - 1, 0))
    }.max() ?? 0
    let height =
      rows.map { $0.map(\.height).max() ?? 0 }.reduce(0, +)
      + spacing * CGFloat(max(rows.count - 1, 0))
    return CGSize(width: min(width, proposal.width ?? width), height: height)
  }

  func placeSubviews(
    in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()
  ) {
    var y = bounds.minY
    var i = 0
    for row in rows(width: bounds.width, subviews: subviews) {
      var x = bounds.minX
      let rowHeight = row.map(\.height).max() ?? 0
      for size in row {
        subviews[i].place(
          at: CGPoint(x: x, y: y + (rowHeight - size.height) / 2), proposal: ProposedViewSize(size))
        x += size.width + spacing
        i += 1
      }
      y += rowHeight + spacing
    }
  }

  // The sizes of each row's chips, a chip too wide for the width narrowed
  // to it rather than clipped.
  private func rows(width: CGFloat, subviews: Subviews) -> [[CGSize]] {
    var rows: [[CGSize]] = [[]]
    var x: CGFloat = 0
    for sub in subviews {
      var size = sub.sizeThatFits(.unspecified)
      if size.width > width {
        size = sub.sizeThatFits(ProposedViewSize(width: width, height: nil))
      }
      if x + size.width > width, !rows[rows.count - 1].isEmpty {
        rows.append([])
        x = 0
      }
      rows[rows.count - 1].append(size)
      x += size.width + spacing
    }
    return rows
  }
}
