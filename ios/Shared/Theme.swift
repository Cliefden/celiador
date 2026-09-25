import SwiftUI

enum Theme {
    static let bg = Color(red: 0.082, green: 0.094, blue: 0.102)
    static let panel = Color(red: 0.106, green: 0.122, blue: 0.133)
    static let border = Color(red: 0.173, green: 0.196, blue: 0.216)
    static let ink = Color(red: 0.914, green: 0.902, blue: 0.871)
    static let dim = Color(red: 0.545, green: 0.573, blue: 0.6)
    static let celadon = Color(red: 0.31, green: 0.635, blue: 0.529)
    static let celadonBright = Color(red: 0.424, green: 0.761, blue: 0.647)
    static let attention = Color(red: 0.851, green: 0.643, blue: 0.255)
    static let red = Color(red: 0.851, green: 0.424, blue: 0.373)
}

extension View {
    func cardStyle() -> some View {
        padding(14)
            .background(Theme.panel)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.border, lineWidth: 1))
    }
}

extension Color {
    /// Parse spec colors like "#B4552D" (falls back to celadon).
    init(hex: String) {
        let cleaned = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        var value: UInt64 = 0
        guard cleaned.count == 6, Scanner(string: cleaned).scanHexInt64(&value) else {
            self = Theme.celadon
            return
        }
        self.init(
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255
        )
    }
}
