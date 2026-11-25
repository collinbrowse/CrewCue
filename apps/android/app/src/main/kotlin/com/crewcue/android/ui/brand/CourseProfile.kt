package com.crewcue.android.ui.brand

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp
import com.crewcue.android.ui.theme.LocalCrewExtras
import kotlin.math.min

/**
 * Course-profile art: an elevation line, the runner's dot, and aid stations.
 * Geometry: `clients/behavior/brand-loader.md` → "Course profile art".
 */
object CourseProfile {
    const val WIDTH = 1000f
    const val HEIGHT = 600f
    const val ASPECT_RATIO = WIDTH / HEIGHT
    val points = listOf(
        Offset(0f, 470f), Offset(120f, 400f), Offset(220f, 430f),
        Offset(350f, 240f), Offset(470f, 300f), Offset(590f, 140f),
        Offset(700f, 270f), Offset(820f, 215f), Offset(1000f, 350f)
    )
    const val RUNNER_INDEX = 5
    val aidIndices = listOf(2, 4, 7)
}

/** [ground] false when the container already paints the slate ground (the Profile hero). */
@Composable
fun CourseProfileArt(modifier: Modifier = Modifier, ground: Boolean = true) {
    val gradient = LocalCrewExtras.current.heroGradient
    val base = if (ground) modifier.background(Brush.verticalGradient(gradient)) else modifier
    Canvas(base) {
        val sx = size.width / CourseProfile.WIDTH
        val sy = size.height / CourseProfile.HEIGHT
        val s = min(sx, sy)
        val points = CourseProfile.points.map { Offset(it.x * sx, it.y * sy) }
        val runner = CourseProfile.RUNNER_INDEX

        val area = Path().apply {
            moveTo(points.first().x, size.height)
            points.forEach { lineTo(it.x, it.y) }
            lineTo(points.last().x, size.height)
            close()
        }
        drawPath(area, Cairn.Cream.copy(alpha = 0.08f))

        drawPath(
            polyline(points.subList(runner, points.size)),
            Cairn.Cream.copy(alpha = 0.55f),
            style = Stroke(
                width = 8 * s,
                cap = StrokeCap.Round,
                join = StrokeJoin.Round,
                pathEffect = PathEffect.dashPathEffect(floatArrayOf(22 * s, 22 * s))
            )
        )
        drawPath(
            polyline(points.subList(0, runner + 1)),
            Cairn.Orange,
            style = Stroke(width = 14 * s, cap = StrokeCap.Round, join = StrokeJoin.Round)
        )

        CourseProfile.aidIndices.forEach { index ->
            if (index < runner) {
                drawCircle(Cairn.Cream, 12 * s, points[index])
            } else {
                drawCircle(Cairn.Slate, 12 * s, points[index])
                drawCircle(Cairn.Cream, 12 * s, points[index], style = Stroke(5 * s))
            }
        }

        val dot = points[runner]
        drawCircle(Cairn.Orange.copy(alpha = 0.25f), 40 * s, dot)
        drawCircle(Cairn.Orange, 20 * s, dot)
        drawCircle(Cairn.Cream, 20 * s, dot, style = Stroke(6 * s))
    }
}

private fun polyline(points: List<Offset>) = Path().apply {
    moveTo(points.first().x, points.first().y)
    points.drop(1).forEach { lineTo(it.x, it.y) }
}

/** The top bar's avatar: the settled Cairn mark on a slate circle. */
@Composable
fun CairnAvatar(modifier: Modifier = Modifier) {
    Box(
        modifier
            .clip(CircleShape)
            .background(Brush.verticalGradient(LocalCrewExtras.current.heroGradient))
    ) {
        CairnMark(elapsedMs = Cairn.SETTLED_MS, modifier = Modifier.fillMaxSize().padding(7.dp))
    }
}
