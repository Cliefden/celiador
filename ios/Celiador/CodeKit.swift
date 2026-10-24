import SwiftUI

/// Grammar-free syntax tinting shared by the diff and code viewers: string literals
/// get a subtle accent and line comments dim out; everything else is plain ink.
enum SyntaxHighlighter {
    static func highlight(_ line: String) -> AttributedString {
        var attr = AttributedString(line)
        attr.foregroundColor = Theme.ink
        func offset(_ i: String.Index) -> Int { line.distance(from: line.startIndex, to: i) }
        func idx(_ n: Int) -> AttributedString.Index { attr.index(attr.startIndex, offsetByCharacters: n) }

        for r in line.ranges(of: /"[^"]*"|'[^']*'/) {
            attr[idx(offset(r.lowerBound))..<idx(offset(r.upperBound))].foregroundColor = Theme.accent
        }
        if let r = line.firstRange(of: "//") ?? line.firstRange(of: "#") {
            attr[idx(offset(r.lowerBound))..<attr.endIndex].foregroundColor = Theme.faint
        }
        return attr
    }

    /// An SF Symbol for a file path's type (shared by the Explorer + diff headers).
    static func icon(forPath path: String) -> String {
        switch (path as NSString).pathExtension.lowercased() {
        case "swift": return "swift"
        case "js", "ts", "jsx", "tsx": return "curlybraces"
        case "json": return "curlybraces.square"
        case "md", "markdown", "txt": return "doc.text"
        case "png", "jpg", "jpeg", "svg", "gif": return "photo"
        case "html", "css": return "chevron.left.forwardslash.chevron.right"
        case "sh", "bash", "zsh": return "terminal"
        default: return "doc"
        }
    }
}

/// A read-only code viewer: monospaced, line-numbered, horizontally scrollable, with
/// light syntax tinting. Reused by the file viewer.
struct CodeView: View {
    let text: String

    private var lines: [(n: Int, s: String)] {
        text.split(separator: "\n", omittingEmptySubsequences: false)
            .enumerated().map { ($0.offset + 1, String($0.element)) }
    }

    var body: some View {
        // Nested scrolls (vertical outer, horizontal inner): a single two-axis
        // ScrollView vertically centers content shorter than the viewport.
        ScrollView(.vertical) {
            ScrollView(.horizontal, showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(lines, id: \.n) { line in
                        HStack(alignment: .top, spacing: 10) {
                            Text("\(line.n)")
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(.tertiary)
                                .frame(minWidth: 32, alignment: .trailing)
                            Text(SyntaxHighlighter.highlight(line.s.isEmpty ? " " : line.s))
                                .font(.footnote.monospaced())
                                .textSelection(.enabled)
                                .fixedSize(horizontal: true, vertical: false)
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 1.5)
                    }
                }
                .padding(.vertical, 8)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}
