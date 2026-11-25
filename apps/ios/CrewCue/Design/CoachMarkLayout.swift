import SwiftUI

/// Where a card goes next to the highlighted control: on the side with the most room, centred on
/// the control along that side and kept inside the margins. Pure, so the placement is tested.
enum CoachMarkLayout {
    enum Side: Equatable { case above, below, leading, trailing, center }

    static let spacing: CGFloat = 12
    static let maxWidth: CGFloat = 440

    /// Above or below the control, whichever has more room, when that room fits a card
    /// (`minimumRoom`); otherwise beside it (a bar down the side of the display), on the wider side.
    /// `.center` without an anchor.
    static let minimumRoom: CGFloat = 220

    static func side(anchor: CGRect?, in bounds: CGRect) -> Side {
        guard let anchor, !anchor.isEmpty else { return .center }
        let above = anchor.minY - bounds.minY, below = bounds.maxY - anchor.maxY
        if max(above, below) >= minimumRoom { return above >= below ? .above : .below }
        let leading = anchor.minX - bounds.minX, trailing = bounds.maxX - anchor.maxX
        if max(leading, trailing) >= 280 { return leading >= trailing ? .leading : .trailing }
        return above >= below ? .above : .below
    }

    /// The card's width and the most height it may take on `side`.
    static func limits(side: Side, anchor: CGRect?, in bounds: CGRect) -> CGSize {
        let fullWidth = min(maxWidth, bounds.width)
        guard let anchor else { return CGSize(width: fullWidth, height: bounds.height) }
        switch side {
        case .above: return CGSize(width: fullWidth, height: max(0, anchor.minY - bounds.minY - spacing))
        case .below: return CGSize(width: fullWidth, height: max(0, bounds.maxY - anchor.maxY - spacing))
        case .leading: return CGSize(width: min(maxWidth, anchor.minX - bounds.minX - spacing), height: bounds.height)
        case .trailing: return CGSize(width: min(maxWidth, bounds.maxX - anchor.maxX - spacing), height: bounds.height)
        case .center: return CGSize(width: fullWidth, height: bounds.height)
        }
    }

    /// The room the card gets on `side`, and how the card sits in it: against the control.
    static func region(side: Side, anchor: CGRect?, in bounds: CGRect) -> (rect: CGRect, alignment: Alignment) {
        let width = limits(side: side, anchor: anchor, in: bounds).width
        func clampX(_ mid: CGFloat) -> CGFloat {
            let low = bounds.minX + width / 2, high = bounds.maxX - width / 2
            return low > high ? bounds.midX : min(max(mid, low), high)
        }
        guard let anchor else {
            return (CGRect(x: bounds.midX - width / 2, y: bounds.minY, width: width, height: bounds.height), .center)
        }
        switch side {
        case .above:
            let x = clampX(anchor.midX) - width / 2
            return (CGRect(x: x, y: bounds.minY, width: width, height: max(0, anchor.minY - spacing - bounds.minY)), .bottom)
        case .below:
            let x = clampX(anchor.midX) - width / 2
            let top = anchor.maxY + spacing
            return (CGRect(x: x, y: top, width: width, height: max(0, bounds.maxY - top)), .top)
        case .leading:
            // Beside the control, level with it: from its top down, or up from its bottom.
            return (CGRect(x: anchor.minX - spacing - width, y: bounds.minY, width: width, height: bounds.height),
                    anchor.midY > bounds.midY ? .bottomTrailing : .topTrailing)
        case .trailing:
            return (CGRect(x: anchor.maxX + spacing, y: bounds.minY, width: width, height: bounds.height),
                    anchor.midY > bounds.midY ? .bottomLeading : .topLeading)
        case .center:
            return (CGRect(x: bounds.midX - width / 2, y: bounds.minY, width: width, height: bounds.height), .center)
        }
    }
}
