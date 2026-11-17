package com.crewcue.android.ui.map

import org.junit.Assert.assertEquals
import org.junit.Test

class CourseFramingTest {
    @Test
    fun theMapScreenKeepsItsWholeRoomOnEveryPhone() {
        // A 411 x 891 dp phone at 2.625: 1079 x 2339 px. The aid sheet's 360 dp stays 360 dp.
        assertEquals(
            CoursePadding(left = 126, top = 525, right = 252, bottom = 945),
            CourseFraming.Screen.paddingPx(2.625f, 1079, 2339)
        )
        // Even a short map, where the room is most of it: exactly the room the screen asks for.
        assertEquals(
            CoursePadding(left = 96, top = 400, right = 192, bottom = 720),
            CourseFraming.Screen.paddingPx(2f, 720, 1000)
        )
    }

    @Test
    fun aPreviewCardCutsItsRoomDownOnlyWhenTheCardIsTooSmall() {
        // Room fits: as asked.
        assertEquals(
            CoursePadding(left = 72, top = 72, right = 72, bottom = 132),
            CourseFraming.Preview.paddingPx(3f, 1000, 600)
        )
        // A 100 px tall card: 204 px of room down to 60 px (60%), in proportion, so the course keeps 40%.
        val small = CourseFraming.Preview.paddingPx(3f, 1000, 100)
        assertEquals(21, small.top)
        assertEquals(38, small.bottom)
        assertEquals(72, small.left)
        assertEquals(72, small.right)
    }
}
