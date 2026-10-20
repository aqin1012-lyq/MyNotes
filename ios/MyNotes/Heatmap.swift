import SwiftUI

/// Daily study minutes over the past `weeks` weeks, one column per week (Mon → Sun), like app.js heatmap().
struct Heatmap: View {
    @Environment(Study.self) private var study
    var weeks = 26
    @State private var picked: String?

    private static let levels: [Color] = [
        Color.secondary.opacity(0.15), Color(hex: 0xD9C9FB), Color(hex: 0xB197F5), Color(hex: 0x8457E8), Color(hex: 0x5A2DBF),
    ]

    private static func level(_ m: Int) -> Int { m == 0 ? 0 : m < 30 ? 1 : m < 60 ? 2 : m < 120 ? 3 : 4 }

    /// Days from the Monday `weeks` weeks back through the end of this week; nil marks days after today.
    private var columns: [[String?]] {
        let cal = Calendar(identifier: .iso8601)
        let today = Day.today
        guard let end = Day.date(today),
              let back = cal.date(byAdding: .day, value: -(weeks * 7 - 1), to: end),
              let start = cal.dateInterval(of: .weekOfYear, for: back)?.start else { return [] }
        var cols: [[String?]] = []
        var d = start
        while Day.string(d) <= today || cols.last?.count ?? 7 < 7 {
            if cols.isEmpty || cols[cols.count - 1].count == 7 { cols.append([]) }
            let s = Day.string(d)
            cols[cols.count - 1].append(s > today ? nil : s)
            d = cal.date(byAdding: .day, value: 1, to: d)!
        }
        return cols
    }

    var body: some View {
        let perDay = study.minutesByDay
        let cols = columns
        VStack(alignment: .leading, spacing: 6) {
            GeometryReader { geo in
                let gap: CGFloat = 2
                let size = max(4, (geo.size.width - gap * CGFloat(cols.count - 1)) / CGFloat(max(1, cols.count)))
                HStack(alignment: .top, spacing: gap) {
                    ForEach(Array(cols.enumerated()), id: \.offset) { _, col in
                        VStack(spacing: gap) {
                            ForEach(Array(col.enumerated()), id: \.offset) { _, day in
                                RoundedRectangle(cornerRadius: 2)
                                    .fill(day.map { Self.levels[Self.level(perDay[$0] ?? 0)] } ?? .clear)
                                    .frame(width: size, height: size)
                                    .overlay { if day != nil, day == picked { RoundedRectangle(cornerRadius: 2).stroke(Theme.pink, lineWidth: 1.5) } }
                                    .onTapGesture { picked = day }
                            }
                        }
                    }
                }
            }
            .aspectRatio(CGFloat(max(1, cols.count)) / 7, contentMode: .fit)

            HStack(spacing: 3) {
                if let p = picked {
                    Text("\(p)：\(perDay[p].map { "\($0) 分钟" } ?? "未学习")")
                } else {
                    Text("少")
                    ForEach(0..<5) { RoundedRectangle(cornerRadius: 2).fill(Self.levels[$0]).frame(width: 10, height: 10) }
                    Text("多")
                    Spacer()
                    Text("<30 / 30–60 / 60–120 / 120+ 分钟")
                }
            }
            .font(.caption2)
            .foregroundStyle(.secondary)
        }
    }
}
