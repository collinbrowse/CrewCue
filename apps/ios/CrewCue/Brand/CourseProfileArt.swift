import SwiftUI

/// Course-profile art: an elevation line, the runner's dot, and aid stations.
/// Geometry: `clients/behavior/brand-loader.md` → "Course profile art".
enum CourseProfile {
    static let canvas = CGSize(width: 1000, height: 600)
    static let points = [
        CGPoint(x: 0, y: 470), CGPoint(x: 120, y: 400), CGPoint(x: 220, y: 430),
        CGPoint(x: 350, y: 240), CGPoint(x: 470, y: 300), CGPoint(x: 590, y: 140),
        CGPoint(x: 700, y: 270), CGPoint(x: 820, y: 215), CGPoint(x: 1000, y: 350)
    ]
    static let runnerIndex = 5
    static let aidIndices = [2, 4, 7]
    /// Width over height of the canvas, for frames that keep its shape.
    static let aspectRatio = canvas.width / canvas.height
}

struct CourseProfileArt: View {
    /// False when the container already paints the slate ground (the Profile hero).
    var ground = true

    var body: some View {
        ZStack {
            if ground {
                LinearGradient(colors: CrewPalette.heroGradient, startPoint: .top, endPoint: .bottom)
            }
            Canvas { context, size in
                let sx = size.width / CourseProfile.canvas.width
                let sy = size.height / CourseProfile.canvas.height
                let s = min(sx, sy)
                let points = CourseProfile.points.map { CGPoint(x: $0.x * sx, y: $0.y * sy) }
                let runner = CourseProfile.runnerIndex

                var area = Path()
                area.move(to: CGPoint(x: points[0].x, y: size.height))
                // addLine, not addLines: addLines starts a new subpath and leaves a gap under the line.
                for point in points {
                    area.addLine(to: point)
                }
                area.addLine(to: CGPoint(x: points[points.count - 1].x, y: size.height))
                area.closeSubpath()
                context.fill(area, with: .color(Cairn.cream.opacity(0.08)))

                var ahead = Path()
                ahead.addLines(Array(points[runner...]))
                context.stroke(
                    ahead,
                    with: .color(Cairn.cream.opacity(0.55)),
                    style: StrokeStyle(lineWidth: 8 * s, lineCap: .round, lineJoin: .round, dash: [22 * s, 22 * s])
                )
                var behind = Path()
                behind.addLines(Array(points[...runner]))
                context.stroke(
                    behind,
                    with: .color(Cairn.orange),
                    style: StrokeStyle(lineWidth: 14 * s, lineCap: .round, lineJoin: .round)
                )

                for index in CourseProfile.aidIndices {
                    let aid = Path(ellipseIn: Self.circle(points[index], radius: 12 * s))
                    if index < runner {
                        context.fill(aid, with: .color(Cairn.cream))
                    } else {
                        context.fill(aid, with: .color(Cairn.slate))
                        context.stroke(aid, with: .color(Cairn.cream), lineWidth: 5 * s)
                    }
                }

                let dot = points[runner]
                context.fill(Path(ellipseIn: Self.circle(dot, radius: 40 * s)), with: .color(Cairn.orange.opacity(0.25)))
                let core = Path(ellipseIn: Self.circle(dot, radius: 20 * s))
                context.fill(core, with: .color(Cairn.orange))
                context.stroke(core, with: .color(Cairn.cream), lineWidth: 6 * s)
            }
        }
    }

    private static func circle(_ center: CGPoint, radius: CGFloat) -> CGRect {
        CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2)
    }
}

/// The top bar's avatar: the settled Cairn mark on a slate circle.
struct CairnAvatar: View {
    var body: some View {
        CairnMark(elapsed: Cairn.settled)
            .padding(7)
            .background(LinearGradient(colors: CrewPalette.heroGradient, startPoint: .top, endPoint: .bottom))
            .clipShape(Circle())
    }
}

#Preview {
    VStack(spacing: 24) {
        CourseProfileArt()
            .aspectRatio(CourseProfile.aspectRatio, contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: CrewRadius.lg, style: .continuous))
        CairnAvatar().frame(width: 40, height: 40)
    }
    .padding()
}
