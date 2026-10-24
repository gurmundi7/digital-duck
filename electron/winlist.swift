// Prints the on-screen window frames as one JSON line whenever they change.
// Bounds come from CoreGraphics, front to back, in points with the primary
// display's top-left as origin (the same space Electron's `screen` uses).
// Needs no permission: titles are left out on purpose, only owners and frames.
import Foundation
import CoreGraphics

let skipPid: Int32 = CommandLine.arguments.count > 1 ? (Int32(CommandLine.arguments[1]) ?? 0) : 0
let skipOwners: Set<String> = ["Window Server", "Dock", "Notification Center", "Control Center", "Spotlight", "Wallpaper", "WindowManager", "Screenshot", "SystemUIServer", "Electron"]

func jsonString(_ s: String) -> String {
    let data = try? JSONSerialization.data(withJSONObject: [s])
    let str = data.flatMap { String(data: $0, encoding: .utf8) } ?? "[\"\"]"
    return String(str.dropFirst().dropLast())
}

var last = ""
while true {
    autoreleasepool {
        guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return }
        var out: [String] = []
        for w in list {
            guard let layer = w[kCGWindowLayer as String] as? Int, layer == 0 else { continue }
            guard let pid = w[kCGWindowOwnerPID as String] as? Int32, pid != skipPid else { continue }
            let owner = (w[kCGWindowOwnerName as String] as? String) ?? ""
            if skipOwners.contains(owner) { continue }
            if let alpha = w[kCGWindowAlpha as String] as? Double, alpha < 0.5 { continue }
            guard let b = w[kCGWindowBounds as String] as? [String: Double] else { continue }
            let x = b["X"] ?? 0, y = b["Y"] ?? 0, wd = b["Width"] ?? 0, ht = b["Height"] ?? 0
            if wd < 180 || ht < 80 { continue }
            let wid = w[kCGWindowNumber as String] as? Int ?? 0
            out.append("{\"id\":\(wid),\"x\":\(Int(x)),\"y\":\(Int(y)),\"w\":\(Int(wd)),\"h\":\(Int(ht)),\"owner\":\(jsonString(owner))}")
        }
        let line = "[" + out.joined(separator: ",") + "]"
        if line != last {
            print(line)
            fflush(stdout)
            last = line
        }
    }
    usleep(250_000)
}
