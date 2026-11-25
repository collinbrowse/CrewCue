package com.crewcue.android.ui.onboarding

import androidx.compose.ui.geometry.Rect
import kotlin.math.max
import kotlin.math.min

/**
 * Where a coach mark's card goes (clients/behavior/onboarding-runner-tour.md, Coach marks): above
 * or below the ringed tab, whichever has room, else beside it (a tab bar down the side of the
 * display, a navigation rail), always inside [safe] (the window less its margins, the system bars
 * and the camera cutout) and off a fold's hinge. Every value is in the overlay's own px; the
 * anchor is the tab's measured frame, never a screen edge. Pure, so it is unit tested.
 */
object CoachMarkLayout {
    enum class Side { Above, Below, Start, End, Center }

    /** The card's top-left, its width, the most height it may take (it scrolls past that), and the side. */
    data class Placement(val x: Float, val y: Float, val width: Float, val maxHeight: Float, val side: Side)

    /**
     * [heightFor] is the card's height at a width (its intrinsic height). [avoid] holds the hinge
     * of a folding display, if any. [minBesideWidth] is the narrowest card worth putting beside a tab.
     */
    fun place(
        safe: Rect,
        anchor: Rect?,
        maxCardWidth: Float,
        gap: Float,
        minBesideWidth: Float,
        avoid: List<Rect> = emptyList(),
        heightFor: (Float) -> Float
    ): Placement {
        val width = min(maxCardWidth, safe.width)
        val placed = if (anchor == null) {
            val height = min(heightFor(width), safe.height)
            Placement(
                x = safe.left + (safe.width - width) / 2,
                y = safe.top + (safe.height - height) / 2,
                width = width,
                maxHeight = safe.height,
                side = Side.Center
            )
        } else {
            around(safe, anchor, width, maxCardWidth, gap, minBesideWidth, heightFor)
        }
        return avoid.fold(placed) { current, hinge -> offHinge(current, hinge, safe, anchor, gap, heightFor) }
    }

    private fun around(
        safe: Rect,
        anchor: Rect,
        width: Float,
        maxCardWidth: Float,
        gap: Float,
        minBesideWidth: Float,
        heightFor: (Float) -> Float
    ): Placement {
        val height = heightFor(width)
        val above = anchor.top - gap - safe.top
        val below = safe.bottom - anchor.bottom - gap
        val x = clamp(anchor.center.x - width / 2, safe.left, safe.right - width)
        if (height <= above) return Placement(x, anchor.top - gap - height, width, above, Side.Above)
        if (height <= below) return Placement(x, anchor.bottom + gap, width, below, Side.Below)
        val end = safe.right - anchor.right - gap
        val start = anchor.left - gap - safe.left
        val besideRoom = max(end, start)
        if (besideRoom >= minBesideWidth) {
            val besideWidth = min(maxCardWidth, besideRoom)
            val besideHeight = min(heightFor(besideWidth), safe.height)
            val y = clamp(anchor.center.y - besideHeight / 2, safe.top, safe.bottom - besideHeight)
            return if (end >= start) {
                Placement(anchor.right + gap, y, besideWidth, safe.height, Side.End)
            } else {
                Placement(anchor.left - gap - besideWidth, y, besideWidth, safe.height, Side.Start)
            }
        }
        // No side has room for all of it: the roomier of above and below, scrolling in that space.
        return if (above >= below) {
            Placement(x, safe.top, width, above, Side.Above)
        } else {
            Placement(x, anchor.bottom + gap, width, below, Side.Below)
        }
    }

    /** Moves the card to the anchor's side of [hinge] when it would sit across it. */
    private fun offHinge(
        placed: Placement,
        hinge: Rect,
        safe: Rect,
        anchor: Rect?,
        gap: Float,
        heightFor: (Float) -> Float
    ): Placement {
        val card = Rect(placed.x, placed.y, placed.x + placed.width, placed.y + min(heightFor(placed.width), placed.maxHeight))
        if (!card.overlaps(hinge)) return placed
        val focus = anchor?.center ?: safe.center
        return if (hinge.height >= hinge.width) {
            // A vertical fold (book posture): keep the card on the anchor's half.
            val half = if (focus.x < hinge.center.x) {
                Rect(safe.left, safe.top, hinge.left - gap, safe.bottom)
            } else {
                Rect(hinge.right + gap, safe.top, safe.right, safe.bottom)
            }
            val width = min(placed.width, half.width)
            val x = clamp(focus.x - width / 2, half.left, half.right - width)
            placed.copy(x = x, width = width)
        } else {
            // A horizontal fold (tabletop): the card stays on the anchor's half.
            val half = if (focus.y < hinge.center.y) {
                Rect(safe.left, safe.top, safe.right, hinge.top - gap)
            } else {
                Rect(safe.left, hinge.bottom + gap, safe.right, safe.bottom)
            }
            val height = min(heightFor(placed.width), half.height)
            val y = when (placed.side) {
                Side.Above -> clamp((anchor?.top ?: half.bottom) - gap - height, half.top, half.bottom - height)
                Side.Below -> clamp((anchor?.bottom ?: half.top) + gap, half.top, half.bottom - height)
                else -> clamp(focus.y - height / 2, half.top, half.bottom - height)
            }
            placed.copy(y = y, maxHeight = min(placed.maxHeight, half.height))
        }
    }

    private fun clamp(value: Float, low: Float, high: Float): Float = if (high < low) low else value.coerceIn(low, high)
}
