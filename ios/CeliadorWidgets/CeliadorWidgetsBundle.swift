import WidgetKit
import SwiftUI

@main
struct CeliadorWidgetsBundle: WidgetBundle {
    var body: some Widget {
        ChatsHomeWidget()
        ChatLiveActivity()
    }
}

/// Colors keyed by the snapshot's coarse bucket, so the widget doesn't need the
/// app's `SessionState` enum.
enum WidgetColor {
    static func dot(_ bucket: String) -> Color {
        switch bucket {
        case "working": return Theme.accent
        case "needs-you": return Theme.attention
        case "error": return Theme.red
        default: return Theme.border
        }
    }
}
