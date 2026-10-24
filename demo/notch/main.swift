// Friday demo notch (10-24): a copy of ~/Cortex/notch for recording product clips. Same panel and animation,
// but it shows ~/Friday/demo/mini.html from the demo server (:8957), has no hotkey (so it never fights Cortex
// over Right Option), and the recording driver opens/closes it through GET /api/notch.
// Build: ~/Friday/demo/notch/build
import Cocoa
import WebKit

let URL_BASE = "http://localhost:8957"
let OPEN_W: CGFloat = 480
let MIN_H: CGFloat = 150, MAX_H: CGFloat = 520
let RIGHT_OPTION: UInt16 = 61

func log(_ s: String) {
  let p = NSHomeDirectory() + "/Friday/demo/notch/notch.log"
  let line = "\(Date()) \(s)\n"
  if let h = FileHandle(forWritingAtPath: p) { h.seekToEndOfFile(); h.write(line.data(using: .utf8)!); h.closeFile() }
  else { try? line.write(toFile: p, atomically: true, encoding: .utf8) }
}

class Panel: NSPanel {
  override var canBecomeKey: Bool { true }
  override var canBecomeMain: Bool { false }
}

class App: NSObject, NSApplicationDelegate, WKScriptMessageHandler {
  var panel: Panel!
  var web: WKWebView!
  var openH: CGFloat = 190
  var isOpen = false, held = false, busy = false
  var outsideSince: Date? = nil
  var lastState = ""
  var idleSince = Date()
  var pinned = false
  var backdrop: NSWindow? = nil

  func screen() -> NSScreen { NSScreen.screens.first { $0.safeAreaInsets.top > 0 } ?? NSScreen.main ?? NSScreen.screens[0] }
  func notchRect() -> NSRect {
    let s = screen(), f = s.frame
    var w: CGFloat = 200, h: CGFloat = max(s.safeAreaInsets.top, 24)
    if let l = s.auxiliaryTopLeftArea, let r = s.auxiliaryTopRightArea { w = f.width - l.width - r.width }
    if s.safeAreaInsets.top == 0 { h = 24 }
    return NSRect(x: f.midX - w / 2, y: f.maxY - h, width: w, height: h)
  }
  func openRect() -> NSRect { let f = screen().frame; return NSRect(x: f.midX - OPEN_W / 2, y: f.maxY - openH, width: OPEN_W, height: openH) }

  func applicationDidFinishLaunching(_ n: Notification) {
    ensureServer()
    let cfg = WKWebViewConfiguration()
    cfg.userContentController.add(self, name: "cortex")
    panel = Panel(contentRect: notchRect(), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    panel.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.mainMenuWindow)) + 2)
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
    panel.isOpaque = false; panel.backgroundColor = .clear; panel.hasShadow = true
    panel.isMovable = false; panel.hidesOnDeactivate = false
    web = WKWebView(frame: panel.contentView!.bounds, configuration: cfg)
    web.autoresizingMask = [.width, .height]
    web.setValue(false, forKey: "drawsBackground")
    panel.contentView!.addSubview(web)
    panel.alphaValue = 0; panel.ignoresMouseEvents = true
    panel.orderFrontRegardless()
    load()
    Timer.scheduledTimer(withTimeInterval: 1.0 / 30, repeats: true) { _ in self.tick() }
    Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { _ in self.healthCheck() }
    Timer.scheduledTimer(withTimeInterval: 0.15, repeats: true) { _ in self.pollCmd() }
    log("started, notch \(notchRect())")
  }

  // the recording driver: "open" = drop down and stay, "close" = tuck back in
  func pollCmd() {
    var r = URLRequest(url: URL(string: URL_BASE + "/api/notch")!); r.timeoutInterval = 1
    URLSession.shared.dataTask(with: r) { d, _, _ in
      guard let d = d, let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any], let c = o["cmd"] as? String, !c.isEmpty else { return }
      DispatchQueue.main.async {
        if c == "open" { self.pinned = true; self.setOpen(true) }
        if c == "close" { self.pinned = false; self.setOpen(false) }
        if c == "reload" { self.load() }
        if c == "backdrop-on" { self.showBackdrop(true) }
        if c == "backdrop-off" { self.showBackdrop(false) }
      }
    }.resume()
  }

  // a plain Friday backdrop just above the desktop, behind every app window, so his own wallpaper never shows on camera
  func showBackdrop(_ on: Bool) {
    if !on { backdrop?.orderOut(nil); backdrop = nil; return }
    if backdrop != nil { return }
    let f = screen().frame
    let w = NSWindow(contentRect: f, styleMask: [.borderless], backing: .buffered, defer: false)
    w.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopIconWindow)) + 1)
    w.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
    w.ignoresMouseEvents = true; w.isOpaque = true; w.hasShadow = false
    let v = NSView(frame: NSRect(origin: .zero, size: f.size)); v.wantsLayer = true
    let g = CAGradientLayer(); g.type = .radial; g.frame = v.bounds
    g.colors = [NSColor(red: 0.16, green: 0.09, blue: 0.03, alpha: 1).cgColor, NSColor(red: 0.03, green: 0.02, blue: 0.03, alpha: 1).cgColor]
    g.startPoint = CGPoint(x: 0.5, y: 1.0); g.endPoint = CGPoint(x: 1.25, y: -0.4)
    v.layer = g
    w.contentView = v
    w.setFrame(f, display: true)
    w.orderFront(nil)
    backdrop = w
  }

  func load() { web.load(URLRequest(url: URL(string: URL_BASE + "/mini.html")!)) }

  func ensureServer() {}   // the demo server is started by the driver
  func ping() -> Bool {
    var ok = false
    let sem = DispatchSemaphore(value: 0)
    var r = URLRequest(url: URL(string: URL_BASE + "/ping")!); r.timeoutInterval = 1
    URLSession.shared.dataTask(with: r) { _, resp, _ in ok = (resp as? HTTPURLResponse)?.statusCode == 200; sem.signal() }.resume()
    _ = sem.wait(timeout: .now() + 1.5)
    return ok
  }
  func healthCheck() {
    DispatchQueue.global().async {
      if !self.ping() { DispatchQueue.main.async { self.load() } }
    }
  }

  func post(_ path: String, _ body: [String: Any]) {
    var r = URLRequest(url: URL(string: URL_BASE + path)!)
    r.httpMethod = "POST"; r.setValue("application/json", forHTTPHeaderField: "Content-Type")
    r.httpBody = try? JSONSerialization.data(withJSONObject: body)
    URLSession.shared.dataTask(with: r).resume()
  }

  func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
    guard let d = m.body as? [String: Any] else { return }
    let s = (d["state"] as? String) ?? ""
    // 10-18 his ask: tuck away while thinking, drop back down when he's talking or Cortex is answering
    let b = ["hearing", "transcribing", "speaking"].contains(s)
    if busy && !b { idleSince = Date() }
    busy = b
    if s != lastState {
      lastState = s
      if s == "thinking" && !held && !pinned { setOpen(false) }
      else if ["hearing", "speaking", "error"].contains(s) { setOpen(true) }
    }
    if let h = d["h"] as? Double {
      let nh = min(MAX_H, max(MIN_H, CGFloat(h)))
      if abs(nh - openH) > 1 {
        openH = nh
        if isOpen { NSAnimationContext.runAnimationGroup({ c in c.duration = 0.18; panel.animator().setFrame(openRect(), display: true) }) }
      }
    }
  }

  func tick() {
    let m = NSEvent.mouseLocation
    if !isOpen {
      if notchRect().insetBy(dx: -12, dy: -2).contains(m) && m.y >= screen().frame.maxY - 6 { setOpen(true) }
      return
    }
    if openRect().insetBy(dx: -10, dy: -10).contains(m) { outsideSince = nil; return }
    if held || busy || pinned { outsideSince = nil; return }
    if Date().timeIntervalSince(idleSince) < 2.5 { return }       // let the last line sit for a beat
    if outsideSince == nil { outsideSince = Date() }
    if Date().timeIntervalSince(outsideSince!) > 0.45 { setOpen(false) }
  }

  func setOpen(_ open: Bool) {
    if open == isOpen { return }
    isOpen = open; outsideSince = nil; idleSince = Date()
    panel.ignoresMouseEvents = !open
    if open { panel.setFrame(notchRect(), display: true); panel.alphaValue = 1 }
    NSAnimationContext.runAnimationGroup({ ctx in
      ctx.duration = open ? 0.28 : 0.2
      ctx.timingFunction = CAMediaTimingFunction(controlPoints: 0.2, 0.9, 0.25, 1.05)
      panel.animator().setFrame(open ? openRect() : notchRect(), display: true)
      if !open { panel.animator().alphaValue = 0 }
    })
    if !open { panel.resignKey() }   // 10-18: never steal the keyboard on hover; it takes focus only when clicked
  }
}

let app = NSApplication.shared
let delegate = App()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
