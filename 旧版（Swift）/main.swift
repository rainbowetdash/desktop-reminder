// 桌面提醒 — 在窗口里编辑提醒，一键写到桌面壁纸上
import SwiftUI
import AppKit
import CoreImage
import ServiceManagement

// MARK: - 设置与存储

struct NoteConfig: Codable, Equatable {
    var title = "我的提醒"
    var text = "- 周五前交报告\n- 给妈妈打电话\n- 买牛奶\n\n记得多喝水 :)"
    var position = "右上"
    var fontSize: Double = 32
    var showDate = true
    var backgroundPath = ""
    var panelOpacity: Double = 0.55
    var theme = "深蓝"
}

let positions = ["左上", "右上", "居中", "左下", "右下"]
let themes: [String: (NSColor, NSColor)] = [
    "深蓝": (NSColor(red: 0.12, green: 0.16, blue: 0.28, alpha: 1), NSColor(red: 0.05, green: 0.06, blue: 0.12, alpha: 1)),
    "暮紫": (NSColor(red: 0.30, green: 0.18, blue: 0.40, alpha: 1), NSColor(red: 0.08, green: 0.06, blue: 0.16, alpha: 1)),
    "森绿": (NSColor(red: 0.12, green: 0.28, blue: 0.24, alpha: 1), NSColor(red: 0.04, green: 0.10, blue: 0.09, alpha: 1)),
    "暖橙": (NSColor(red: 0.55, green: 0.30, blue: 0.20, alpha: 1), NSColor(red: 0.18, green: 0.08, blue: 0.08, alpha: 1)),
    "石墨": (NSColor(red: 0.22, green: 0.22, blue: 0.24, alpha: 1), NSColor(red: 0.07, green: 0.07, blue: 0.08, alpha: 1)),
]
let themeOrder = ["深蓝", "暮紫", "森绿", "暖橙", "石墨"]

enum Store {
    static let dir: URL = {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("DesktopNote", isDirectory: true)
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        return base
    }()
    static var configURL: URL { dir.appendingPathComponent("config.json") }
    static var hasSaved: Bool { FileManager.default.fileExists(atPath: configURL.path) }

    static func load() -> NoteConfig {
        guard let d = try? Data(contentsOf: configURL),
              let c = try? JSONDecoder().decode(NoteConfig.self, from: d) else { return NoteConfig() }
        return c
    }
    static func save(_ c: NoteConfig) {
        if let d = try? JSONEncoder().encode(c) { try? d.write(to: configURL) }
    }
}

func todayString() -> String {
    let f = DateFormatter()
    f.locale = Locale(identifier: "zh_CN")
    f.dateFormat = "yyyy年M月d日  EEEE"
    return f.string(from: Date())
}

// MARK: - 生成壁纸图片

enum Renderer {
    static let ci = CIContext()

    static func background(_ cfg: NoteConfig, w: Int, h: Int) -> CGImage? {
        guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        if !cfg.backgroundPath.isEmpty,
           let ns = NSImage(contentsOfFile: cfg.backgroundPath),
           let img = ns.cgImage(forProposedRect: nil, context: nil, hints: nil) {
            // 等比铺满、居中裁剪
            let iw = CGFloat(img.width), ih = CGFloat(img.height)
            let s = max(CGFloat(w) / iw, CGFloat(h) / ih)
            let dw = iw * s, dh = ih * s
            ctx.interpolationQuality = .high
            ctx.draw(img, in: CGRect(x: (CGFloat(w) - dw) / 2, y: (CGFloat(h) - dh) / 2, width: dw, height: dh))
        } else {
            let (top, bottom) = themes[cfg.theme] ?? themes["深蓝"]!
            let colors = [top.cgColor, bottom.cgColor] as CFArray
            if let g = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 1]) {
                ctx.drawLinearGradient(g, start: CGPoint(x: 0, y: CGFloat(h)), end: CGPoint(x: CGFloat(w) * 0.3, y: 0), options: [])
            }
        }
        return ctx.makeImage()
    }

    static func content(_ cfg: NoteConfig, base: CGFloat) -> NSAttributedString {
        let out = NSMutableAttributedString()
        let white = NSColor(white: 1, alpha: 0.96)

        if !cfg.title.trimmingCharacters(in: .whitespaces).isEmpty {
            let p = NSMutableParagraphStyle()
            p.paragraphSpacing = base * 0.15
            out.append(NSAttributedString(string: cfg.title + "\n", attributes: [
                .font: NSFont.systemFont(ofSize: base * 1.4, weight: .semibold),
                .foregroundColor: white, .paragraphStyle: p]))
        }
        if cfg.showDate {
            let p = NSMutableParagraphStyle()
            p.paragraphSpacing = base * 0.7
            out.append(NSAttributedString(string: todayString() + "\n", attributes: [
                .font: NSFont.systemFont(ofSize: base * 0.68, weight: .regular),
                .foregroundColor: NSColor(white: 1, alpha: 0.6), .paragraphStyle: p]))
        }

        let body = NSFont.systemFont(ofSize: base, weight: .regular)
        let indent = base * 1.2
        let lines = cfg.text.components(separatedBy: "\n")
        for (i, raw) in lines.enumerated() {
            var line = raw.trimmingCharacters(in: .whitespaces)
            let p = NSMutableParagraphStyle()
            p.lineSpacing = base * 0.2
            p.paragraphSpacing = base * 0.4
            if line.hasPrefix("- ") || line.hasPrefix("* ") || line.hasPrefix("・") || line.hasPrefix("•") {
                line = line.hasPrefix("- ") || line.hasPrefix("* ") ? String(line.dropFirst(2)) : String(line.dropFirst(1))
                line = "•\t" + line.trimmingCharacters(in: .whitespaces)
                p.tabStops = [NSTextTab(textAlignment: .left, location: indent)]
                p.defaultTabInterval = indent
                p.headIndent = indent
            }
            let end = i == lines.count - 1 ? "" : "\n"
            out.append(NSAttributedString(string: line + end, attributes: [
                .font: body, .foregroundColor: white, .paragraphStyle: p]))
        }
        return out
    }

    static func render(_ cfg: NoteConfig, width: Int, height: Int) -> CGImage? {
        let w = CGFloat(width), h = CGFloat(height)
        guard let bg = background(cfg, w: width, h: height),
              let ctx = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        ctx.draw(bg, in: CGRect(x: 0, y: 0, width: w, height: h))

        let base = CGFloat(cfg.fontSize) * h / 1080
        let pad = base * 1.1
        let panelW = min(max(w * 0.30, base * 14), w - 40)
        let textW = panelW - pad * 2
        let text = content(cfg, base: base)
        let textH = ceil(text.boundingRect(with: CGSize(width: textW, height: .greatestFiniteMagnitude),
                                           options: [.usesLineFragmentOrigin, .usesFontLeading]).height)
        let panelH = textH + pad * 2
        let margin = min(w, h) * 0.06

        // 以左上角为原点计算面板位置
        var x: CGFloat, y: CGFloat
        switch cfg.position {
        case "左上": x = margin; y = margin * 1.2
        case "左下": x = margin; y = h - panelH - margin * 1.6
        case "右下": x = w - panelW - margin; y = h - panelH - margin * 1.6
        case "居中": x = (w - panelW) / 2; y = (h - panelH) / 2
        default:    x = w - panelW - margin; y = margin * 1.2   // 右上
        }

        // 毛玻璃面板（CoreGraphics 坐标原点在左下）
        let rect = CGRect(x: x, y: h - y - panelH, width: panelW, height: panelH)
        let path = CGPath(roundedRect: rect, cornerWidth: base * 0.9, cornerHeight: base * 0.9, transform: nil)
        let blurred = CIImage(cgImage: bg).clampedToExtent()
            .applyingGaussianBlur(sigma: Double(base) * 0.9).cropped(to: rect)
        if let blurImg = ci.createCGImage(blurred, from: rect) {
            ctx.saveGState(); ctx.addPath(path); ctx.clip()
            ctx.draw(blurImg, in: rect)
            ctx.restoreGState()
        }
        ctx.addPath(path)
        ctx.setFillColor(NSColor(red: 0.04, green: 0.05, blue: 0.09, alpha: CGFloat(cfg.panelOpacity)).cgColor)
        ctx.fillPath()
        ctx.addPath(path)
        ctx.setStrokeColor(NSColor(white: 1, alpha: 0.10).cgColor)
        ctx.setLineWidth(max(1, base * 0.04))
        ctx.strokePath()

        // 文字（翻转坐标系，用 AppKit 排版中文）
        ctx.saveGState()
        ctx.translateBy(x: 0, y: h)
        ctx.scaleBy(x: 1, y: -1)
        let old = NSGraphicsContext.current
        NSGraphicsContext.current = NSGraphicsContext(cgContext: ctx, flipped: true)
        text.draw(with: CGRect(x: x + pad, y: y + pad, width: textW, height: textH + base),
                  options: [.usesLineFragmentOrigin, .usesFontLeading])
        NSGraphicsContext.current = old
        ctx.restoreGState()

        return ctx.makeImage()
    }

    static func screenPixelSize(_ screen: NSScreen) -> (Int, Int) {
        let s = screen.backingScaleFactor
        return (Int(screen.frame.width * s), Int(screen.frame.height * s))
    }

    static func preview(_ cfg: NoteConfig, width: CGFloat) -> NSImage? {
        guard let screen = NSScreen.main else { return nil }
        let (sw, sh) = screenPixelSize(screen)
        let pw = Int(width * 2), ph = Int(CGFloat(pw) * CGFloat(sh) / CGFloat(sw))
        guard let img = render(cfg, width: pw, height: ph) else { return nil }
        return NSImage(cgImage: img, size: NSSize(width: width, height: CGFloat(ph) / 2))
    }

    /// 生成并设为所有屏幕的壁纸
    static func applyWallpaper(_ cfg: NoteConfig) throws {
        let fm = FileManager.default
        for f in (try? fm.contentsOfDirectory(at: Store.dir, includingPropertiesForKeys: nil)) ?? []
        where f.lastPathComponent.hasPrefix("wallpaper_") { try? fm.removeItem(at: f) }

        let stamp = Int(Date().timeIntervalSince1970)
        for (i, screen) in NSScreen.screens.enumerated() {
            let (w, h) = screenPixelSize(screen)
            guard let img = render(cfg, width: w, height: h),
                  let png = NSBitmapImageRep(cgImage: img).representation(using: .png, properties: [:]) else { continue }
            let url = Store.dir.appendingPathComponent("wallpaper_\(stamp)_\(i).png")
            try png.write(to: url)
            try NSWorkspace.shared.setDesktopImageURL(url, for: screen, options: [
                .imageScaling: NSImageScaling.scaleProportionallyUpOrDown.rawValue,
                .allowClipping: true])
        }
        UserDefaults.standard.set(todayString(), forKey: "lastAppliedDate")
    }
}

// MARK: - 开机启动

enum LoginItem {
    static var isOn: Bool {
        if #available(macOS 13.0, *) { return SMAppService.mainApp.status == .enabled }
        return false
    }
    static func set(_ on: Bool) -> String? {
        guard #available(macOS 13.0, *) else { return "需要 macOS 13 或更新版本" }
        do {
            if on { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
            return nil
        } catch {
            return "设置开机启动失败：\(error.localizedDescription)"
        }
    }
}

// MARK: - 界面

struct ContentView: View {
    @State private var cfg = Store.load()
    @State private var preview: NSImage?
    @State private var status = ""
    @State private var launchAtLogin = LoginItem.isOn

    private var bgName: String {
        cfg.backgroundPath.isEmpty ? "纯色渐变" : (cfg.backgroundPath as NSString).lastPathComponent
    }

    var body: some View {
        HStack(alignment: .top, spacing: 24) {
            editor.frame(width: 340)
            previewPane
        }
        .padding(24)
        .frame(minWidth: 860, minHeight: 600)
        .onAppear { refreshPreview() }
        .onChange(of: cfg) { _ in refreshPreview() }
    }

    private var editor: some View {
        VStack(alignment: .leading, spacing: 14) {
            section("标题") {
                TextField("例如：我的提醒", text: $cfg.title)
                    .textFieldStyle(.roundedBorder)
            }

            section("提醒内容", hint: "每行一条。行首写「- 」会变成圆点。") {
                TextEditor(text: $cfg.text)
                    .font(.system(size: 14))
                    .padding(6)
                    .background(Color(nsColor: .textBackgroundColor))
                    .cornerRadius(8)
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.secondary.opacity(0.25)))
                    .frame(minHeight: 170)
            }

            section("显示位置") {
                Picker("", selection: $cfg.position) {
                    ForEach(positions, id: \.self) { Text($0).tag($0) }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
            }

            HStack {
                Text("文字大小").font(.subheadline.weight(.medium))
                Slider(value: $cfg.fontSize, in: 18...64)
                Text("\(Int(cfg.fontSize))").monospacedDigit().frame(width: 28, alignment: .trailing)
            }
            HStack {
                Text("面板深浅").font(.subheadline.weight(.medium))
                Slider(value: $cfg.panelOpacity, in: 0.1...0.9)
            }
            Toggle("显示今天的日期", isOn: $cfg.showDate)

            section("背景") {
                HStack(spacing: 8) {
                    if cfg.backgroundPath.isEmpty {
                        Picker("", selection: $cfg.theme) {
                            ForEach(themeOrder, id: \.self) { Text($0).tag($0) }
                        }
                        .labelsHidden()
                        .frame(width: 90)
                    } else {
                        Text(bgName).lineLimit(1).truncationMode(.middle)
                            .foregroundColor(.secondary)
                    }
                    Spacer()
                    Button("用自己的图片…") { pickImage() }
                    if !cfg.backgroundPath.isEmpty {
                        Button("换回纯色") { cfg.backgroundPath = "" }
                    }
                }
            }

            Toggle("开机自动打开（每天自动更新日期）", isOn: $launchAtLogin)
                .onChange(of: launchAtLogin) { on in
                    if let err = LoginItem.set(on) { status = err; launchAtLogin = LoginItem.isOn }
                }

            Spacer(minLength: 4)

            Button(action: apply) {
                Text("应用到桌面壁纸").font(.headline).frame(maxWidth: .infinity).padding(.vertical, 4)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .keyboardShortcut("s", modifiers: .command)

            Text(status.isEmpty ? "改好后点上面的按钮，或按 ⌘S" : status)
                .font(.caption).foregroundColor(.secondary)
        }
    }

    private var previewPane: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("预览").font(.subheadline.weight(.medium))
            Group {
                if let preview {
                    Image(nsImage: preview).resizable().aspectRatio(contentMode: .fit)
                } else {
                    Rectangle().fill(Color.secondary.opacity(0.1))
                }
            }
            .cornerRadius(10)
            .shadow(color: .black.opacity(0.25), radius: 8, y: 3)
            Text("壁纸只会换到当前桌面。如果你开了多个桌面（调度中心里的多个空间），切到那个桌面后再点一次「应用」就行。")
                .font(.caption).foregroundColor(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder
    private func section<C: View>(_ title: String, hint: String? = nil, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.subheadline.weight(.medium))
            if let hint { Text(hint).font(.caption).foregroundColor(.secondary) }
            content()
        }
    }

    private func refreshPreview() {
        preview = Renderer.preview(cfg, width: 460)
    }

    private func pickImage() {
        let panel = NSOpenPanel()
        panel.allowedFileTypes = ["jpg", "jpeg", "png", "heic", "tiff", "bmp", "webp"]
        panel.allowsMultipleSelection = false
        panel.message = "选择一张图片作为壁纸底图"
        if panel.runModal() == .OK, let url = panel.url { cfg.backgroundPath = url.path }
    }

    private func apply() {
        Store.save(cfg)
        do {
            try Renderer.applyWallpaper(cfg)
            let f = DateFormatter(); f.dateFormat = "HH:mm"
            status = "✓ 壁纸已更新（\(f.string(from: Date()))）"
        } catch {
            status = "更新失败：\(error.localizedDescription)"
        }
    }
}

// MARK: - App

final class AppDelegate: NSObject, NSApplicationDelegate {
    var timer: Timer?

    func applicationDidFinishLaunching(_ notification: Notification) {
        refreshIfNewDay()
        // 每 10 分钟检查一次是否跨天，跨天就刷新壁纸上的日期
        timer = Timer.scheduledTimer(withTimeInterval: 600, repeats: true) { [weak self] _ in self?.refreshIfNewDay() }
        NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in self?.refreshIfNewDay() }
    }

    func refreshIfNewDay() {
        guard Store.hasSaved else { return }
        let cfg = Store.load()
        guard cfg.showDate, UserDefaults.standard.string(forKey: "lastAppliedDate") != todayString() else { return }
        try? Renderer.applyWallpaper(cfg)
    }

    // 关掉窗口后继续在后台运行，以便每天更新日期；点 Dock 图标可重新打开
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
}

@main
struct DesktopNoteApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var delegate

    var body: some Scene {
        WindowGroup("桌面提醒") {
            ContentView()
        }
    }
}
