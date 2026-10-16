import SwiftUI

/// The Cairn mark and its motion. Geometry and timing: `clients/behavior/brand-loader.md`.
enum Cairn {
    static let cream = Color(red: 0xF3 / 255, green: 0xEC / 255, blue: 0xDD / 255)
    static let slate = Color(red: 0x34 / 255, green: 0x40 / 255, blue: 0x4F / 255)
    static let orange = Color(red: 0xFF / 255, green: 0x7A / 255, blue: 0x3D / 255)
    static let launchBackground = Color("LaunchBackground")

    struct Stone {
        let rect: CGRect
        let degrees: Double
        let pivot: CGPoint
        let start: Double
    }

    /// Bottom to top, in 1024-unit icon space.
    static let stones = [
        Stone(rect: CGRect(x: 282, y: 640, width: 460, height: 150), degrees: 0, pivot: CGPoint(x: 512, y: 715), start: 0.11),
        Stone(rect: CGRect(x: 352, y: 474, width: 320, height: 136), degrees: -4, pivot: CGPoint(x: 512, y: 542), start: 0.55),
        Stone(rect: CGRect(x: 414, y: 326, width: 196, height: 118), degrees: 6, pivot: CGPoint(x: 512, y: 385), start: 0.99)
    ]
    /// Tight square around the stones, for loaders.
    static let crop = CGRect(x: 232, y: 272, width: 560, height: 560)
    /// The whole icon canvas, so the stones sit where they do on the app icon.
    static let iconCrop = CGRect(x: 0, y: 0, width: 1024, height: 1024)
    static let drop = 0.44
    static let lift = 260.0
    static let period = 2.2
    static let fadeStart = 1.89
    /// The top stone has landed.
    static let settled = 1.43

    static func pose(_ stone: Stone, at elapsed: Double) -> (offset: Double, opacity: Double) {
        let progress = min(max((elapsed - stone.start) / drop, 0), 1)
        return ((1 - easeOutBack(progress)) * -lift, min(progress / 0.3, 1))
    }

    /// Shake loader: separate, shake, close, rest. See "Shake" in the spec.
    static let shakeCrop = CGRect(x: 192, y: 192, width: 640, height: 640)
    static let shakePeriod = 1.4
    static let shakeGap = 48.0
    static let shakeAmplitude = 20.0
    static let shakeDegrees = 7.0

    struct ShakePose {
        var dx = 0.0
        var dy = 0.0
        var degrees = 0.0
    }

    static func shakePose(_ index: Int, at elapsed: Double) -> ShakePose {
        let t = elapsed.truncatingRemainder(dividingBy: shakePeriod)
        let separation: Double = switch t {
        case ..<0.25: easeInOutCubic(t / 0.25)
        case ..<1.05: 1
        case ..<1.3: 1 - easeInOutCubic((t - 1.05) / 0.25)
        default: 0
        }
        var pose = ShakePose(dy: -shakeGap * Double(index) * separation)
        if t >= 0.25 && t < 1.05 {
            let q = (t - 0.25) / 0.8
            let wave = sin(6 * .pi * q + 2 * .pi / 3 * Double(index)) * sin(.pi * q)
            pose.dx = shakeAmplitude * wave
            pose.degrees = shakeDegrees * wave
        }
        return pose
    }

    private static func easeInOutCubic(_ p: Double) -> Double {
        p < 0.5 ? 4 * p * p * p : 1 - pow(2 - 2 * p, 3) / 2
    }

    private static func easeOutBack(_ x: Double) -> Double {
        let overshoot = 1.7
        return 1 + (overshoot + 1) * pow(x - 1, 3) + overshoot * pow(x - 1, 2)
    }
}

/// The three stones at `elapsed` seconds into one stack.
struct CairnMark: View {
    var elapsed: Double
    var opacity: Double = 1
    var onLight = false
    var crop = Cairn.crop

    var body: some View {
        CairnStones(onLight: onLight, crop: crop) { _, stone in
            let pose = Cairn.pose(stone, at: elapsed)
            return (0, pose.offset, 0, pose.opacity * opacity)
        }
    }
}

/// Draws the stones, each moved by `pose(index, stone)`: sideways and vertical offset, extra degrees, opacity.
private struct CairnStones: View {
    var onLight: Bool
    var crop: CGRect
    var pose: (Int, Cairn.Stone) -> (dx: Double, dy: Double, degrees: Double, opacity: Double)

    var body: some View {
        Canvas { context, size in
            let scale = min(size.width, size.height) / crop.width
            context.translateBy(x: (size.width - crop.width * scale) / 2, y: (size.height - crop.height * scale) / 2)
            context.scaleBy(x: scale, y: scale)
            context.translateBy(x: -crop.minX, y: -crop.minY)
            for (index, stone) in Cairn.stones.enumerated() {
                let moved = pose(index, stone)
                var stoneContext = context
                stoneContext.opacity = moved.opacity
                stoneContext.translateBy(x: stone.pivot.x + moved.dx, y: stone.pivot.y + moved.dy)
                stoneContext.rotate(by: .degrees(stone.degrees + moved.degrees))
                stoneContext.translateBy(x: -stone.pivot.x, y: -stone.pivot.y)
                let color = index == Cairn.stones.count - 1 ? Cairn.orange : (onLight ? Cairn.slate : Cairn.cream)
                stoneContext.fill(Path(roundedRect: stone.rect, cornerRadius: stone.rect.height / 2), with: .color(color))
            }
        }
    }
}

/// Looping loader: the stones stack, the stack clears, repeat.
struct CairnLoader: View {
    var onLight = true
    var crop = Cairn.crop
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(paused: reduceMotion)) { timeline in
            let t = reduceMotion
                ? Cairn.settled
                : timeline.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: Cairn.period)
            let fade = t < Cairn.fadeStart ? 1 : 1 - (t - Cairn.fadeStart) / (Cairn.period - Cairn.fadeStart)
            CairnMark(elapsed: t, opacity: fade, onLight: onLight, crop: crop)
        }
        .accessibilityElement()
        .accessibilityLabel("Loading")
    }
}

/// Small inline loader: the rows separate, shake out of phase, and settle. Reduce Motion shows the plain stack.
struct CairnShakeLoader: View {
    var onLight = true
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(paused: reduceMotion)) { timeline in
            let t = reduceMotion ? 0 : timeline.date.timeIntervalSinceReferenceDate
            CairnStones(onLight: onLight, crop: Cairn.shakeCrop) { index, _ in
                let pose = Cairn.shakePose(index, at: t)
                return (pose.dx, pose.dy, pose.degrees, 1)
            }
        }
        .accessibilityElement()
        .accessibilityLabel("Loading")
    }
}

/// Plays one stack over the launch colour, then fades out.
struct LaunchSplash: View {
    var onFinished: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var start = Date()
    @State private var fading = false

    var body: some View {
        TimelineView(.animation(paused: reduceMotion || fading)) { timeline in
            CairnMark(elapsed: reduceMotion ? Cairn.settled : timeline.date.timeIntervalSince(start))
                .frame(width: 160, height: 160)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Cairn.launchBackground)
        .ignoresSafeArea()
        .opacity(fading ? 0 : 1)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .task {
            try? await Task.sleep(for: .seconds(Cairn.settled + 0.25))
            withAnimation(.easeOut(duration: 0.3)) { fading = true }
            try? await Task.sleep(for: .seconds(0.3))
            onFinished()
        }
    }
}
