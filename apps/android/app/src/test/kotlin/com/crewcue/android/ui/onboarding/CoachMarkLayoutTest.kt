package com.crewcue.android.ui.onboarding

import androidx.compose.ui.geometry.Rect
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CoachMarkLayoutTest {
    private val phone = Rect(16f, 40f, 396f, 860f)

    private fun place(safe: Rect, anchor: Rect?, height: Float = 300f, avoid: List<Rect> = emptyList()) =
        CoachMarkLayout.place(safe, anchor, maxCardWidth = 440f, gap = 12f, minBesideWidth = 240f, avoid = avoid) { height }

    @Test
    fun aBottomTabGetsTheCardAboveItInsideTheMargins() {
        val profile = Rect(300f, 800f, 380f, 850f)
        val placed = place(phone, profile)
        assertEquals(CoachMarkLayout.Side.Above, placed.side)
        assertEquals(800f - 12f - 300f, placed.y)
        // Full width less the margins, never off the right edge.
        assertEquals(380f, placed.width)
        assertEquals(16f, placed.x)
    }

    @Test
    fun aTopAnchorGetsTheCardBelowIt() {
        val placed = place(phone, Rect(100f, 60f, 180f, 110f))
        assertEquals(CoachMarkLayout.Side.Below, placed.side)
        assertEquals(110f + 12f, placed.y)
    }

    @Test
    fun aRailDownTheSideGetsTheCardBesideIt() {
        // A wide, short window: the bar runs down the left edge.
        val wide = Rect(16f, 16f, 1184f, 584f)
        val rail = Rect(16f, 260f, 96f, 320f)
        val placed = place(wide, rail, height = 420f)
        assertEquals(CoachMarkLayout.Side.End, placed.side)
        assertEquals(96f + 12f, placed.x)
        assertEquals(440f, placed.width)
        assertTrue(placed.y >= wide.top && placed.y + 420f <= wide.bottom)
    }

    @Test
    fun aCardWithNoTabIsCentred() {
        val placed = place(phone, null)
        assertEquals(CoachMarkLayout.Side.Center, placed.side)
        assertEquals(16f, placed.x)
        assertEquals(40f + (820f - 300f) / 2, placed.y)
    }

    @Test
    fun theCardStaysOffAVerticalHingeOnTheAnchorsHalf() {
        val open = Rect(16f, 40f, 1060f, 860f)
        val hinge = Rect(530f, 0f, 546f, 900f)
        val map = Rect(400f, 800f, 500f, 850f)
        val placed = place(open, map, avoid = listOf(hinge))
        assertTrue(placed.x + placed.width <= hinge.left)
        assertTrue(placed.x >= open.left)
        val card = Rect(placed.x, placed.y, placed.x + placed.width, placed.y + 300f)
        assertFalse(card.overlaps(hinge))
    }

    @Test
    fun aCardNarrowedOffAVerticalHingeIsPlacedForItsNewHeight() {
        // Text wraps: the narrower the card, the taller it is.
        val open = Rect(16f, 40f, 1060f, 860f)
        val hinge = Rect(430f, 0f, 446f, 900f)
        val map = Rect(300f, 800f, 400f, 850f)
        val heightFor = { width: Float -> 120_000f / width }
        val placed = CoachMarkLayout.place(open, map, maxCardWidth = 600f, gap = 12f, minBesideWidth = 240f, avoid = listOf(hinge), heightFor = heightFor)
        assertTrue(placed.x + placed.width <= hinge.left)
        val height = heightFor(placed.width)
        assertTrue(height > heightFor(600f))
        // Still above the tab, with its bottom a gap above it, at the taller height.
        assertEquals(CoachMarkLayout.Side.Above, placed.side)
        assertEquals(800f - 12f - height, placed.y, 0.01f)
        assertEquals(800f - 12f - open.top, placed.maxHeight, 0.01f)
    }

    @Test
    fun aTallCardWithNoRoomScrollsInTheRoomierSpace() {
        val placed = place(phone, Rect(100f, 450f, 180f, 500f), height = 2_000f)
        assertEquals(CoachMarkLayout.Side.Above, placed.side)
        assertEquals(phone.top, placed.y)
        assertEquals(450f - 12f - phone.top, placed.maxHeight)
    }
}
