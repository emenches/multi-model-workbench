import AppKit
import Foundation
import WebKit

// Exercises the real macOS WKWebView engine with deterministic local fixtures.
// It does NOT launch Cogitor or access real third-party accounts / tokens.
final class Probe: NSObject, WKURLSchemeHandler, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    var loads = 0
    var denied: [String] = []
    var popupAttempts = 0
    var messages: [String] = []
    var errors: [String] = []
    var mode = "toolbar"

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else {
            task.didFailWithError(NSError(domain: "fixture", code: 1)); return
        }
        let body: String
        switch url.host {
        case "toolbar.test":
            body = "<!doctype html><html><body><h1>Toolbar</h1><iframe id='hostile' src='cogitorfixture://hostile.test/frame'></iframe></body></html>"
        case "hostile.test":
            body = "<!doctype html><html><body>Hostile frame<script>window.hostileFixture = true</script></body></html>"
        case "mail.test":
            body = """
            <!doctype html><html><body>
            <a id="claude" href="https://claude.ai/auth/verify?token=fixture-only">Claude</a>
            <a id="spoof" href="https://claude.ai.evil.test/auth/verify">Spoof</a>
            </body></html>
            """
        default:
            task.didFailWithError(NSError(domain: "fixture", code: 2)); return
        }
        let bytes = Data(body.utf8)
        task.didReceive(URLResponse(url: url, mimeType: "text/html", expectedContentLength: bytes.count, textEncodingName: "utf-8"))
        task.didReceive(bytes)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        let isFrame = action.targetFrame?.isMainFrame == false
        let local = url.scheme == "cogitorfixture" && ["toolbar.test", "hostile.test", "mail.test"].contains(url.host ?? "")
        let validMain = url.scheme == "cogitorfixture" && url.host == (mode == "toolbar" ? "toolbar.test" : "mail.test")
        let allowed = isFrame ? local : validMain
        if !allowed { denied.append(url.absoluteString) }
        decisionHandler(allowed ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        popupAttempts += 1
        return nil // deny all popups in the privileged toolbar fixture
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { loads += 1 }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { errors.append(error.localizedDescription) }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) { messages.append(String(describing: message.body)) }
}

func check(_ value: @autoclosure () -> Bool, _ what: String) {
    guard value() else { fputs("FAIL: \(what)\n", stderr); exit(1) }
    print("PASS: \(what)")
    fflush(stdout)
}

func wait(_ condition: () -> Bool, seconds: TimeInterval = 12) -> Bool {
    let deadline = Date().addingTimeInterval(seconds)
    while Date() < deadline {
        if condition() { return true }
        _ = RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.05))
    }
    return condition()
}

func evaluate(_ view: WKWebView, _ source: String) throws -> Any? {
    var finished = false
    var result: Any?
    var error: Error?
    view.evaluateJavaScript(source) { value, failure in
        result = value; error = failure; finished = true
    }
    guard wait({ finished }) else { throw NSError(domain: "WKJavaScript timed out", code: 1) }
    if let error { throw error }
    return result
}

func makeView(_ probe: Probe, mode: String, injection: String? = nil) -> (WKWebView, NSWindow) {
    probe.mode = mode
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .nonPersistent()
    configuration.setURLSchemeHandler(probe, forURLScheme: "cogitorfixture")
    configuration.preferences.javaScriptCanOpenWindowsAutomatically = true
    if mode == "toolbar" {
        configuration.userContentController.add(probe, name: "privilegedToolbarOnly")
    }
    if let injection {
        configuration.userContentController.addUserScript(WKUserScript(source: injection, injectionTime: .atDocumentStart, forMainFrameOnly: false))
    }
    let view = WKWebView(frame: NSRect(x: 0, y: 0, width: 600, height: 400), configuration: configuration)
    view.navigationDelegate = probe
    view.uiDelegate = probe
    let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 600, height: 400), styleMask: [.titled], backing: .buffered, defer: false)
    window.contentView = view
    window.orderOut(nil)
    view.load(URLRequest(url: URL(string: "cogitorfixture://\(mode == "toolbar" ? "toolbar.test" : "mail.test")/main")!))
    return (view, window)
}

let application = NSApplication.shared
application.setActivationPolicy(.prohibited)
print("Real WKWebView test: \(ProcessInfo.processInfo.operatingSystemVersionString)")

// A local toolbar and an external frame have different WebKit origins.
let toolbarProbe = Probe()
let (toolbarView, toolbarWindow) = makeView(toolbarProbe, mode: "toolbar")
check(wait({ toolbarProbe.loads >= 1 }), "native WKWebView loads privileged-page fixture")
let sameOriginPolicy = try evaluate(toolbarView, "try { void window.frames[0].document.body; 'allowed' } catch (e) { e.name }") as? String
check(sameOriginPolicy == "SecurityError", "WebKit prevents cross-origin frame DOM access")

// The delegate enforces an allowlist against top-level redirects and new windows.
_ = try evaluate(toolbarView, "window.location.assign('https://untrusted.test/from-toolbar')")
check(wait({ toolbarProbe.denied.contains(where: { $0.contains("untrusted.test") }) }), "navigation delegate denies external toolbar navigation")
check(toolbarView.url?.host == "toolbar.test", "blocked URL cannot replace privileged toolbar")
_ = try evaluate(toolbarView, "window.open('https://untrusted.test/new-window', '_blank')")
check(wait({ toolbarProbe.popupAttempts >= 1 }), "native WebKit receives and denies popup request")

// Separate WebViews must have separate injected message-handler capabilities.
let source = CommandLine.arguments.dropFirst().first ?? "src-tauri/src/claude_email_link_activation.js"
let injection = try String(contentsOfFile: source, encoding: .utf8)
let emailProbe = Probe()
let (emailView, emailWindow) = makeView(emailProbe, mode: "email", injection: injection)
check(wait({ emailProbe.loads >= 1 }), "email WKWebView loads actual Cogitor click-injection script")
let emailHasToolbarHandler = try evaluate(emailView, "typeof (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.privilegedToolbarOnly)") as? String
check(emailHasToolbarHandler == "undefined", "email WebView lacks privileged toolbar message handler")
let toolbarHasHandler = try evaluate(toolbarView, "typeof window.webkit.messageHandlers.privilegedToolbarOnly") as? String
check(toolbarHasHandler == "object", "toolbar-only handler is available in its own WebView")

// Untrusted synthetic events must not be accepted as human clicks by WebKit.
let forgery = try evaluate(emailView, """
(function () {
 const ev = new MouseEvent('click', {bubbles: true, cancelable: true, button: 0});
 try { Object.defineProperty(ev, 'isTrusted', {value: true}); }
 catch (_) { return false; }
 return ev.isTrusted;
})()
""")
check(forgery as? Bool == false, "script cannot forge MouseEvent.isTrusted")
let intercepted = try evaluate(emailView, """
(function () {
 const anchor = document.getElementById('claude');
 const event = new MouseEvent('click', {bubbles:true, cancelable:true, button:0});
 anchor.dispatchEvent(event);
 return event.defaultPrevented;
})()
""")
check(intercepted as? Bool == false, "real Cogitor email link listener ignores synthetic clicks")
let spoofed = try evaluate(emailView, """
(function () {
 const anchor = document.getElementById('spoof');
 const event = new MouseEvent('click', {bubbles:true, cancelable:true, button:0});
 anchor.dispatchEvent(event);
 return event.defaultPrevented;
})()
""")
check(spoofed as? Bool == false, "host spoofing does not activate click handoff")

_ = (toolbarWindow, emailWindow) // retain windows until test completes
print("WK_RUNTIME_PROBE_ALL_PASSED")
