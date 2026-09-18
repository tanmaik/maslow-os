# iOS 26, Liquid Glass, and what makes an iPhone app feel native

Researched 2026-09-17 from primary sources only: the Human Interface
Guidelines (Materials, Tab bars, Toolbars, Search fields, Searching, Sheets,
Buttons, Typography, Motion, Layout, Color, Dark Mode, Scroll views,
Accessibility), Apple's "Adopting Liquid Glass" and "Applying Liquid Glass to
custom views" guides, the Landmarks sample, the SwiftUI reference page of
every API below, and the WWDC25 transcripts of "Meet Liquid Glass" (219),
"Get to know the new design system" (356) and "Build a SwiftUI app with the
new design" (323). Every signature in part 2 is copied from the symbol's own
page; anything not found there is flagged. The HIG has no "Navigation bars"
page any more: since June 2025 that guidance is inside "Toolbars".

## 1. The rules that decide whether an app feels native on iOS 26

### What Liquid Glass is, and the one place it goes

- Liquid Glass "forms a distinct functional layer for controls and
  navigation elements — like tab bars and sidebars — that floats above the
  content layer". It bends light, blurs what is under it, flips light/dark by
  itself on small elements (bars, buttons), and flexes under a finger.
- "Don't use Liquid Glass in the content layer." Lists, cards, rows,
  backgrounds: never glass; use the standard materials (`.ultraThin`,
  `.thin`, `.regular`, `.thick`) there. Sole exception: a slider or toggle
  knob turns to glass while touched, and the system does that itself.
- "Always avoid glass on glass." Never stack it. Things drawn on a glass
  surface use fills, transparency and vibrancy, not more glass.
- "Use Liquid Glass effects sparingly." Standard components get it free;
  custom glass is for the few most important floating controls (Maps' buttons
  over the map), and every custom glass view goes in one
  `GlassEffectContainer`, because "glass can not sample other glass".
- Two variants, never mixed in one app. `.regular` is adaptive and works
  anywhere. `.clear` has no adaptive behaviour and is only for controls over
  photos or video, when a dimming layer (35% black over bright media) is
  acceptable, and when what sits on it is bold and bright.
- At rest (first launch, top of a scroll) content and glass should not
  intersect: reposition or scale content to keep separation.
- Reduce Transparency (frostier), Increase Contrast (black/white plus a
  border) and Reduce Motion (no elastic flex) are applied to every glass
  element automatically; custom colours and animations must be tested under
  all three, plus Dark Mode.

### Navigation hierarchy

- "It's more important than ever for your app to have a clear and consistent
  navigation structure that's distinct from the content." Tab bar for
  top-level sections, toolbar for actions on the current view; never actions
  in a tab bar.
- Tab bars: single-word labels, filled SF Symbols, never disabled or hidden
  tabs, avoid More, badges only for critical information. The bar floats and
  may minimize on scroll (iPhone only); an accessory (Music's mini player)
  rides above it and collapses inline. No screen-specific actions (a
  Checkout button) in the accessory.
- Search: a `Tab(role: .search)` is separated and placed trailing by the
  system. Otherwise search goes in the bottom toolbar "if there's room", at
  the top only when the bottom must stay clear for content.
- Toolbars: items share a glass background in logical groups (at most three,
  fixed spacers between). Icons over text; never an icon and a text item in
  one group; text-labelled actions get their own container. One `.prominent`
  (tinted) primary action, trailing. Standard Back and Close symbols, never
  the words. Titles under 15 characters, never the app name. Large title on
  iOS so people know where they are as they scroll.
- Sheets: half-height sheets are inset glass whose bottom corners nest in the
  display; at full height they go opaque. Support `.medium` for progressive
  disclosure, show the grabber when resizable, support swipe to dismiss, pair
  Done with Cancel, never Cancel + Done + Back together, one sheet at a time.
  A sheet is a scoped task in the current context; a prolonged or multi-step
  flow gets full-screen presentation; going deeper in a hierarchy is a push
  in `NavigationStack`. A modal sheet gets a dimming layer; a parallel
  non-modal task (Notes formatting) does not.
- Action sheets and dialogs now spring from the control that raised them.
  Menus, popovers and sheets can morph out of a glass button with the zoom
  transition.

### Concentricity and shape

- "The shape of the hardware informs the curvature of controls." Nested
  shapes share a corner centre: inner radius = outer radius minus padding.
  Three shape kinds: fixed radius, capsule (radius is half the height),
  concentric (computed from the container).
- Bordered buttons are capsules by default on iOS. A button at the bottom of
  a sheet shares its corner centre with the sheet; near the screen edge use a
  capsule with extra margin. Pinched or flared corners in a nested container
  mean the inner shape should have been concentric. Custom toolbar components
  must be concentric with the bar's corners.

### Colour

- Glass has no colour of its own. Bar glyphs are monochrome and flip with the
  glass. "Apply color sparingly to the Liquid Glass material, and to symbols
  or text on the material." Tint one primary action, on its background (the
  prominent style), not its glyph; "refrain from adding color to the
  background of multiple controls". A solid fill instead of glass tinting
  "breaks the visual character".
- Colourful content: keep bars monochrome or pick an accent with real
  contrast. Monochrome content: the brand colour as accent works.
- Use the semantic colours (`label`, `secondaryLabel`, `separator`, system and
  grouped backgrounds) and never redefine them. Every custom colour ships
  light, dark and increased-contrast variants "even if your app ships in a
  single appearance mode". Never offer an app-level light/dark switch.
  Contrast at least 4.5:1 for text up to 17 pt, 3:1 from 18 pt, 7:1 for
  custom small text.

### Standard control sizes and shapes

- Hit region at least 44x44 pt; every custom button has a press state.
- `controlSize`: `.mini` `.small` `.regular` `.large` `.extraLarge`; iOS 26
  adds real extra-large buttons for the one or two prominent actions in a
  view. Distinguish the preferred choice by style, never by size.
- Lists, tables and forms got taller rows, more padding, larger section
  radii, and title-case section headers; `Form` + `.grouped` inherits it all.

### Scroll edge effects

- The blur-and-fade that dissolves content scrolling under a floating bar.
  "Not decorative", it "doesn't block or darken like overlays", and exists
  only where content scrolls under floating UI. One per view (one per pane
  in a split, at equal heights).
- Prefer `.automatic`. `.soft` is the iOS default under glass buttons and
  inputs; `.hard` (near-opaque line) is for pinned headers or bare text that
  needs a firm boundary. Never mix or stack them. Anything drawn behind a bar
  fights the effect: remove it. A custom pinned bar joins the effect with
  `safeAreaBar`.

### Typography and Dynamic Type

- SF Pro; body 17 pt, minimum 11 pt; Regular, Medium, Semibold, Bold only
  (no Ultralight, Thin, Light). Text styles, never fixed sizes, so Dynamic
  Type and the five accessibility sizes come free. Default sizes: Large
  Title 34, Title 1 28, Title 2 22, Title 3 20, Headline 17 semibold, Body 17,
  Callout 16, Subhead 15, Footnote 13, Caption 1 12, Caption 2 11.
- Layout must survive AX5 (body 53 pt): stack what was side by side, let
  rows grow, no truncation in scrollable regions, icons scale with text (SF
  Symbols do), same hierarchy order. Non-text metrics use `@ScaledMetric`.
- Alerts and onboarding text is now bolder and left-aligned.

### Motion

- "Add motion purposefully." Brief, precise feedback tied to the gesture; no
  added motion on frequent interactions; "let people cancel motion".
- Springs are the vocabulary. `.smooth`, `.snappy`, `.bouncy`,
  `.spring(duration:bounce:)` are persistent springs: a new one on the same
  property replaces its predecessor "preserving velocity from one animation
  to the next", which is what makes them interruptible. Glass "materializes"
  rather than fades.
- Under Reduce Motion: tighten springs to remove bounce, track gestures
  directly, replace x/y/z moves with fades, never animate into or out of a
  blur, no auto-playing or repetitive motion. Read
  `\.accessibilityReduceMotion` and ship a second variant of every custom
  animation.

### Layout

- Safe areas and size classes (compact/regular), never device type.
  Full-screen backgrounds extend under bars. "Instead of applying a solid or
  semi-opaque background color beneath controls, use a scroll edge effect to
  visually elevate controls above content." Where a sidebar or inspector
  would cover the important part of an image, use the background extension
  effect (mirror and blur) rather than scrolling content under it.

## 2. SwiftUI API catalogue (signatures copied from the reference)

Version shown is iOS; iPadOS and Mac Catalyst match unless noted.

### Glass on custom views (iOS 26.0)

```swift
func glassEffect(_ glass: Glass = .regular, in shape: some Shape = DefaultGlassEffectShape()) -> some View
struct Glass                      // static var regular, clear, identity
func tint(_ color: Color?) -> Glass;  func interactive(_ isEnabled: Bool = true) -> Glass
struct DefaultGlassEffectShape    // a capsule
struct GlassEffectContainer<Content: View>;  init(spacing: CGFloat? = nil, @ContentBuilder content: () -> Content)
func glassEffectID(_ id: (some Hashable & Sendable)?, in namespace: Namespace.ID) -> some View
func glassEffectUnion(id: (some Hashable & Sendable)?, namespace: Namespace.ID) -> some View
func glassEffectTransition(_ transition: GlassEffectTransition) -> some View
struct GlassEffectTransition      // static var matchedGeometry (default inside spacing), materialize, identity
```

```swift
Label("Desert", systemImage: "sun.max.fill").padding().glassEffect(in: .rect(cornerRadius: 16))
Label("Go", systemImage: "arrow.right").padding().glassEffect(.regular.tint(.orange).interactive())
Label("Flag", systemImage: "flag.fill").padding().glassEffect(.clear).background(.black.opacity(0.3))

@Namespace private var ns
GlassEffectContainer(spacing: 40) {
    HStack(spacing: 40) {
        Image(systemName: "scribble.variable").frame(width: 80, height: 80)
            .glassEffect().glassEffectID("pencil", in: ns)
        if isExpanded {
            Image(systemName: "eraser.fill").frame(width: 80, height: 80)
                .glassEffect().glassEffectID("eraser", in: ns)
        }
    }
}
Button("Toggle") { withAnimation { isExpanded.toggle() } }.buttonStyle(.glass)
```

Apply `glassEffect` after every modifier that affects appearance. Container
spacing larger than the inner stack's spacing makes shapes blend at rest.

### Glass button styles (iOS 26.0)

```swift
static var glass: GlassButtonStyle;  static var glassProminent: GlassProminentButtonStyle   // PrimitiveButtonStyle
static func glass(_ glass: Glass) -> Self                                                 // .buttonStyle(.glass(.clear))
Button("Get Started") { }.buttonStyle(.glassProminent);  Button("Learn More") { }.buttonStyle(.glass)
```

### Button shape and size

```swift
func buttonBorderShape(_ shape: ButtonBorderShape) -> some View   // iOS 15; .capsule, .roundedRectangle
func controlSize(_ controlSize: ControlSize) -> some View          // iOS 15; .extraLarge iOS 17
func buttonSizing(_ sizing: ButtonSizing) -> some View             // iOS 26; .fitted, .flexible
Button("Continue", action: go).buttonStyle(.glassProminent).controlSize(.extraLarge).buttonSizing(.flexible)
```

### Concentric shapes (iOS 26.0)

```swift
struct ConcentricRectangle     // init() = every corner concentric with the container
init(topLeadingCorner:topTrailingCorner:bottomLeadingCorner:bottomTrailingCorner:)
init(uniformTopCorners:uniformBottomCorners:)                      // corner styles: .concentric, .concentric(minimum:), .fixed(_:)
static func rect(corners: Edge.Corner.Style, isUniform: Bool = false) -> Self   // on Shape
ConcentricRectangle(uniformTopCorners: .fixed(24), uniformBottomCorners: .concentric).fill(.green)
CustomControl().background(.tint, in: .rect(corners: .concentric(minimum: 12), isUniform: true))
```

Flag: WWDC25 323 shows `.rect(corner: .containerConcentric)`; that spelling is
not in the shipped reference. Use `ConcentricRectangle` / `rect(corners:isUniform:)`.

### Tab bar (iOS 26.0 unless noted)

```swift
func tabBarMinimizeBehavior(_ behavior: TabBarMinimizeBehavior) -> some View   // static let onScrollDown, onScrollUp, automatic, never; iPhone only
func tabViewBottomAccessory<Content: View>(@ContentBuilder content: () -> Content) -> some View
var tabViewBottomAccessoryPlacement: TabViewBottomAccessoryPlacement? { get }  // EnvironmentValues; enum { inline, expanded }
init(role: TabRole?, @ContentBuilder content: () -> Content)                   // Tab, iOS 18
init(_ titleKey: LocalizedStringKey, systemImage: String, role: TabRole?, content:)   // Tab, iOS 18
static var search: TabRole                                                     // iOS 18
func tabViewSearchActivation(_ activation: TabSearchActivation) -> some View   // .searchTabSelection
static var sidebarAdaptable: SidebarAdaptableTabViewStyle                      // iOS 18
```

```swift
TabView {
    Tab("Home", systemImage: "house") { HomeView() }
    Tab("Alerts", systemImage: "bell") { AlertsView() }
    Tab(role: .search) { NavigationStack { SearchTabContent() } }
}
.searchable(text: $query)
.tabBarMinimizeBehavior(.onScrollDown)
.tabViewBottomAccessory { NowPlayingBar() }   // inside: @Environment(\.tabViewBottomAccessoryPlacement) == .inline ? compact : full
```

### Toolbars

```swift
struct ToolbarSpacer;  init(_ sizing: SpacerSizing = .flexible, placement: ToolbarItemPlacement = .automatic)   // iOS 26; .fixed, .flexible
func sharedBackgroundVisibility(_ visibility: Visibility) -> some ToolbarContent   // iOS 26, on ToolbarContent
struct DefaultToolbarItem;  init(kind: ToolbarDefaultItemKind, placement: ToolbarItemPlacement = .automatic)  // iOS 26; kind .search
func hidden(_ hidden: Bool = true) -> some ToolbarContent                          // iOS 26.4
func badge(_ count: Int) -> some View                                              // iOS 15; on a toolbar button (WWDC25)
func toolbarTitleDisplayMode(_ mode: ToolbarTitleDisplayMode) -> some View         // iOS 17; .inlineLarge
func navigationSubtitle(_ subtitleKey: LocalizedStringResource) -> some View       // iOS 26
static let largeSubtitle: ToolbarItemPlacement;  static let subtitle: ToolbarItemPlacement   // iOS 26
```

```swift
ScrollView { content }
    .navigationTitle("Inbox").navigationSubtitle("12 unread")
    .searchable(text: $query)
    .toolbar {
        ToolbarItem { ShareLink(item: url) }
        ToolbarSpacer(.fixed)
        ToolbarItem { FavoriteButton() }
        ToolbarItem { Button("Notifications", systemImage: "bell") { }.badge(unread) }
        ToolbarItem { ProfileButton() }.sharedBackgroundVisibility(.hidden)
        ToolbarItem(placement: .bottomBar) { FilterPicker() }
        ToolbarSpacer(.flexible, placement: .bottomBar)
        DefaultToolbarItem(kind: .search, placement: .bottomBar)
        ToolbarSpacer(.fixed, placement: .bottomBar)
        ToolbarItem(placement: .bottomBar) { NewMessageButton() }
    }
```

Hide the `ToolbarItem` with `.hidden(...)`; hiding the view inside leaves an
empty glass pill.

### Search

```swift
func searchable(text: Binding<String>, placement: SearchFieldPlacement = .automatic, prompt: LocalizedStringResource) -> some View  // iOS 16
func searchable(text:isPresented:placement:prompt:)                                    // iOS 17
func searchToolbarBehavior(_ behavior: SearchToolbarBehavior) -> some View              // iOS 26; .automatic, .minimize
func searchPresentationToolbarBehavior(_ behavior: SearchPresentationToolbarBehavior) -> some View   // iOS 17.1; .avoidHidingContent
NavigationStack { RecipeList() }.searchable(text: $query, prompt: "Recipes").searchToolbarBehavior(.minimize)
```

Flag: the modifier's own sample writes `.minimized`; the declared property is
`static var minimize` and WWDC25 uses `.minimize`. Use `.minimize`. Put
`searchable` on the `NavigationSplitView`/`TabView`, not on one column.

### Navigation transitions and presentations

```swift
func navigationTransition(_ style: some NavigationTransition) -> some View       // iOS 18; on the destination's root, outside any stack
static func zoom(sourceID: some Hashable, in namespace: Namespace.ID) -> ZoomNavigationTransition   // iOS 18
func matchedTransitionSource(id: some Hashable, in namespace: Namespace.ID) -> some View   // iOS 18 (+ configuration: overload)
func sheet<Content>(isPresented: Binding<Bool>, onDismiss: (() -> Void)? = nil, @ContentBuilder content: @escaping () -> Content) -> some View
func presentationDetents(_ detents: Set<PresentationDetent>) -> some View          // iOS 16; .medium, .large, .height(_:); (+ selection:)
func presentationDragIndicator(_ visibility: Visibility) -> some View              // iOS 16
func presentationBackgroundInteraction(_ interaction: PresentationBackgroundInteraction) -> some View   // iOS 16.4
func presentationBackground<S: ShapeStyle>(_ style: S) -> some View                // iOS 16.4; do not use on iOS 26 sheets
func presentationCornerRadius(_ cornerRadius: CGFloat?) -> some View               // iOS 16.4; leave nil on iOS 26
func interactiveDismissDisabled(_ isDisabled: Bool = true) -> some View            // iOS 15
func confirmationDialog(_:isPresented:titleVisibility:presenting:actions:)         // anchors to its control on iOS 26
```

```swift
@Namespace private var ns
ContentView()
    .toolbar {
        ToolbarItem(placement: .bottomBar) {
            Button { showMap = true } label: { Image(systemName: "map") }
                .matchedTransitionSource(id: "map", in: ns)
        }
    }
    .sheet(isPresented: $showMap) {
        MapSheet()
            .navigationTransition(.zoom(sourceID: "map", in: ns))
            .presentationDetents([.height(180), .medium, .large])
            .presentationDragIndicator(.visible)
            .presentationBackgroundInteraction(.enabled(upThrough: .height(180)))
    }
```

### Backgrounds, scroll edges, scroll behaviour

```swift
func backgroundExtensionEffect() -> some View                                       // iOS 26; one instance per screen
func scrollEdgeEffectStyle(_ style: ScrollEdgeEffectStyle?, for edges: Edge.Set) -> some View   // iOS 26; .automatic, .soft, .hard
func scrollEdgeEffectHidden(_ hidden: Bool = true, for edges: Edge.Set = .all) -> some View      // iOS 26
func safeAreaBar(edge: HorizontalEdge, alignment: VerticalAlignment = .center, spacing: CGFloat? = nil, @ContentBuilder content: () -> some View) -> some View  // iOS 26
func scrollTargetBehavior(_ behavior: some ScrollTargetBehavior) -> some View       // iOS 17; .paging, .viewAligned (+ scrollTargetLayout())
func contentMargins(_ edges: Edge.Set = .all, _ insets: EdgeInsets, for placement: ContentMarginPlacement = .automatic) -> some View   // iOS 17
func contentMargins(_ length: CGFloat, for placement: ContentMarginPlacement = .automatic) -> some View  // iOS 17
func scrollBounceBehavior(_ behavior: ScrollBounceBehavior, axes: Axis.Set = [.vertical]) -> some View  // iOS 16.4
func scrollDismissesKeyboard(_ mode: ScrollDismissesKeyboardMode) -> some View       // iOS 16
func listSectionMargins(_ edges: Edge.Set = .all, _ length: CGFloat?) -> some View   // iOS 26
ScrollView { LazyVStack { ForEach(rows) { Row($0) } } }.scrollEdgeEffectStyle(.hard, for: .top)   // only under a pinned header
Image(hero).resizable().aspectRatio(contentMode: .fill).backgroundExtensionEffect()
ScrollView(.horizontal) { LazyHStack(spacing: 10) { ForEach(items) { Card($0) } }.scrollTargetLayout() }
    .scrollTargetBehavior(.viewAligned).contentMargins(.horizontal, 20)
```

`safeAreaBar` is `safeAreaInset` plus "it extends the edge effect of any
scroll views affected by the inset safe area". Only the `HorizontalEdge`
overload was fetched; a vertical one is likely but unverified.

### Dynamic Type and motion

```swift
enum Font.TextStyle        // .largeTitle … .caption2;  Text("…").font(.body)
enum DynamicTypeSize       // @Environment(\.dynamicTypeSize); .isAccessibilitySize; >= .accessibility1
@propertyWrapper struct ScaledMetric<Value: BinaryFloatingPoint>   // @ScaledMetric var pad = 12.0
static func spring(duration: TimeInterval = 0.5, bounce: Double = 0.0, blendDuration: Double = 0) -> Animation
static func smooth(duration: TimeInterval = 0.5, extraBounce: Double = 0.0) -> Animation   // base bounce 0
static func snappy(duration: TimeInterval = 0.5, extraBounce: Double = 0.0) -> Animation   // base bounce 0.15
static func bouncy(duration: TimeInterval = 0.5, extraBounce: Double = 0.0) -> Animation   // base bounce 0.3
var accessibilityReduceMotion: Bool { get }                                // EnvironmentValues
func contentTransition(_ transition: ContentTransition) -> some View       // iOS 16; .numericText(), .symbolEffect
func symbolEffect<T, U>(_ effect: T, options: SymbolEffectOptions = .default, value: U) -> some View   // iOS 17
@Environment(\.accessibilityReduceMotion) private var reduceMotion
withAnimation(reduceMotion ? .smooth(duration: 0.2) : .snappy) { isOpen.toggle() }
```

### Compatibility switch

`UIDesignRequiresCompatibility` (Info.plist, Boolean, iOS 26.0): `YES` runs
the app as it looked against previous SDKs; "Temporarily use this key while
reviewing and refining"; ignored from iOS 27. A new app never sets it.

## 3. Known pitfalls

- Custom backgrounds behind bars: `toolbarBackground`, a colour or gradient
  behind `NavigationStack`, `TabView` or `toolbar`, a material "for
  legibility". They overlay the glass and kill the scroll edge effect, which
  is the legibility. `toolbarBackgroundVisibility(.visible, for: .tabBar)`
  is for exceptions, not a default.
- `glassEffect` on content (cards, rows, backgrounds): "unnecessary
  complexity and a confusing visual hierarchy".
- Glass on glass: a `glassEffect` inside a toolbar, sheet or another glass
  view; two custom glass views in separate containers that overlap ("glass
  can not sample other glass"); more than one custom glass view with no
  `GlassEffectContainer` (no morphing, wrong sampling, slower); glass on a
  control's inner views instead of the control.
- Tinting everything: accent on every bar item, a solid brand fill instead
  of glass tinting, overriding the monochrome glyphs. `.tint` is for
  meaning, on one item.
- `presentationBackground` / `presentationCornerRadius` on sheets: the iOS
  26 sheet is inset glass with a system radius that goes opaque at full
  height; a custom material or radius removes that.
- A text button and a symbol in one toolbar group read as one control;
  hiding an item's content rather than the item.
- Hard-coded control heights, row heights, radii, spacing: iOS 26 changed
  them all, and standard controls without fixed metrics adopt the new ones on
  rebuild. Fixed radii inside rounded containers pinch; use
  `ConcentricRectangle`. Upper-cased section header strings: the system
  renders them title case now.
- `tabBarMinimizeBehavior` on iPad does nothing ("only iPhone").
- Same-axis nested scroll views; two scroll edge effects in one view;
  `.hard` under ordinary glass buttons; `scrollEdgeEffectHidden` to "clean
  up" a bar that then loses legibility.
- `UIDesignRequiresCompatibility = YES` to dodge the redesign: a temporary
  review aid, ignored on iOS 27.
- `.font(.system(size:))` for UI text and light weights: no Dynamic Type.
- Animations that ignore Reduce Motion or that the person must wait out.
- Beta-era spellings in samples and blog posts: `glassEffect(_:in:isEnabled:)`,
  `rect(corner: .containerConcentric)`, `.minimized`,
  `tabViewBottomAccessory(isPresented:content:)`. None are in the shipped
  reference; the forms in part 2 are.

Not verified against a reference page: the vertical-edge `safeAreaBar`
overload; `Edge.Corner.Style` cases beyond `.concentric`,
`.concentric(minimum:)` and `.fixed(_:)`; `PresentationDetent.fraction(_:)`
(iOS 16 API, page not fetched).
