// Prints upcoming calendar events as one JSON array and exits.
// Usage: agenda <minutesAhead>. Asks for calendar access on first run.
import Foundation
import EventKit

let minutes = CommandLine.arguments.count > 1 ? (Double(CommandLine.arguments[1]) ?? 90) : 90
let store = EKEventStore()
let sema = DispatchSemaphore(value: 0)
var granted = false

func request() {
    if #available(macOS 14.0, *) {
        store.requestFullAccessToEvents { ok, _ in granted = ok; sema.signal() }
    } else {
        store.requestAccess(to: .event) { ok, _ in granted = ok; sema.signal() }
    }
}
request()
_ = sema.wait(timeout: .now() + 120)
if !granted { print("{\"error\":\"calendar access denied\"}"); exit(2) }

let now = Date()
let pred = store.predicateForEvents(withStart: now.addingTimeInterval(-15 * 60), end: now.addingTimeInterval(minutes * 60), calendars: nil)
let iso = ISO8601DateFormatter()
func js(_ s: String) -> String {
    let d = try? JSONSerialization.data(withJSONObject: [s])
    let str = d.flatMap { String(data: $0, encoding: .utf8) } ?? "[\"\"]"
    return String(str.dropFirst().dropLast())
}
var out: [String] = []
for e in store.events(matching: pred).sorted(by: { $0.startDate < $1.startDate }) {
    if e.isAllDay { continue }
    if e.status == .canceled { continue }
    let mine = e.attendees?.first(where: { $0.isCurrentUser })
    if let m = mine, m.participantStatus == .declined { continue }
    let id = e.eventIdentifier ?? "\(e.startDate.timeIntervalSince1970)-\(e.title ?? "")"
    out.append("{\"id\":\(js(id)),\"title\":\(js(e.title ?? "Untitled")),\"start\":\(js(iso.string(from: e.startDate))),\"end\":\(js(iso.string(from: e.endDate))),\"calendar\":\(js(e.calendar.title)),\"location\":\(js(e.location ?? "")),\"url\":\(js(e.url?.absoluteString ?? ""))}")
}
print("[" + out.joined(separator: ",") + "]")
