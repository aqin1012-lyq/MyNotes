import SwiftUI

/// Colours mirroring the web app (purple accent, yellow-green for done/current, pink for risk).
enum Theme {
    static let accent = Color(hex: 0x6D3FD6)
    static let accentSoft = Color(hex: 0xE9E0FD)
    static let lime = Color(hex: 0xC5E84A)
    static let limeInk = Color(hex: 0x1F2A05)
    static let limeLine = Color(hex: 0x5A8F0E)
    static let pink = Color(hex: 0xEC7A9C)
    static let pinkSoft = Color(hex: 0xFFE3EB)

    static func difficulty(_ d: String) -> (Color, String) {
        switch d {
        case "E": return (limeLine, "简单")
        case "H": return (pink, "困难")
        default:  return (accent, "中等")
        }
    }
}

extension Color {
    init(hex: UInt, alpha: Double = 1) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xff) / 255,
                  green: Double((hex >> 8) & 0xff) / 255,
                  blue: Double(hex & 0xff) / 255,
                  opacity: alpha)
    }
}

/// A small rounded pill tag, like the ones on the web.
struct Pill: View {
    let text: String
    var color: Color = Theme.accentSoft
    var body: some View {
        Text(text)
            .font(.caption)
            .padding(.horizontal, 9).padding(.vertical, 2)
            .background(color, in: Capsule())
            .foregroundStyle(.primary)
    }
}

/// A thin progress bar.
struct Bar: View {
    let value: Double // 0...1
    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.secondary.opacity(0.18))
                Capsule().fill(value >= 1 ? Theme.limeLine : Theme.accent)
                    .frame(width: max(0, min(1, value)) * geo.size.width)
            }
        }
        .frame(height: 7)
    }
}
