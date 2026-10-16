package com.crewcue.android.ui.brand

import android.provider.Settings
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.withInfiniteAnimationFrameMillis
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlin.math.PI
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin

/** The Cairn mark and its motion. Geometry and timing: `clients/behavior/brand-loader.md`. */
object Cairn {
    val Cream = Color(0xFFF3ECDD)
    val Slate = Color(0xFF34404F)
    val SlateDeep = Color(0xFF1F2833)
    val Orange = Color(0xFFFF7A3D)
    val LaunchBackground = Color(0xFF29333F)

    class Stone(val rect: Rect, val degrees: Float, val pivot: Offset, val startMs: Long)

    /** Bottom to top, in 1024-unit icon space. */
    val stones = listOf(
        Stone(Rect(282f, 640f, 742f, 790f), 0f, Offset(512f, 715f), 110),
        Stone(Rect(352f, 474f, 672f, 610f), -4f, Offset(512f, 542f), 550),
        Stone(Rect(414f, 326f, 610f, 444f), 6f, Offset(512f, 385f), 990)
    )

    /** Tight square around the stones, for loaders. */
    val crop = Rect(232f, 272f, 792f, 832f)

    /** The whole icon canvas, so the stones sit where they do on the app icon. */
    val iconCrop = Rect(0f, 0f, 1024f, 1024f)

    const val DROP_MS = 440L
    const val LIFT = 260f
    const val PERIOD_MS = 2200L
    const val FADE_START_MS = 1890L

    /** The top stone has landed. */
    const val SETTLED_MS = 1430L

    /** Vertical offset (units) and opacity for a stone at [elapsedMs] into one stack. */
    fun pose(stone: Stone, elapsedMs: Long): Pair<Float, Float> {
        val progress = ((elapsedMs - stone.startMs).toFloat() / DROP_MS).coerceIn(0f, 1f)
        return (1 - easeOutBack(progress)) * -LIFT to min(progress / 0.3f, 1f)
    }

    /** Shake loader: separate, shake, close, rest. See "Shake" in the spec. */
    val shakeCrop = Rect(212f, 212f, 812f, 812f)
    const val SHAKE_PERIOD_MS = 1400L
    const val SHAKE_GAP = 48f
    const val SHAKE_AMPLITUDE = 32f
    const val SHAKE_DEGREES = 2f

    class ShakePose(val dx: Float, val dy: Float, val degrees: Float)

    fun shakePose(index: Int, elapsedMs: Long): ShakePose {
        val t = elapsedMs % SHAKE_PERIOD_MS
        val separation = when {
            t < 250 -> easeInOutCubic(t / 250f)
            t < 1050 -> 1f
            t < 1300 -> 1 - easeInOutCubic((t - 1050) / 250f)
            else -> 0f
        }
        val wave = if (t in 250 until 1050) {
            val q = (t - 250) / 800f
            sin(6 * PI.toFloat() * q + 2 * PI.toFloat() / 3 * index) * sin(PI.toFloat() * q)
        } else 0f
        return ShakePose(SHAKE_AMPLITUDE * wave, -SHAKE_GAP * index * separation, SHAKE_DEGREES * wave)
    }

    private fun easeInOutCubic(p: Float): Float = if (p < 0.5f) 4 * p * p * p else 1 - (2 - 2 * p).pow(3) / 2

    private fun easeOutBack(x: Float): Float {
        val overshoot = 1.7f
        return 1 + (overshoot + 1) * (x - 1).pow(3) + overshoot * (x - 1).pow(2)
    }
}

/** The three stones at [elapsedMs] into one stack. */
@Composable
fun CairnMark(
    elapsedMs: Long,
    modifier: Modifier = Modifier,
    alpha: Float = 1f,
    onLight: Boolean = false,
    crop: Rect = Cairn.crop
) {
    CairnStones(modifier, onLight, crop) { _, stone ->
        val (offset, opacity) = Cairn.pose(stone, elapsedMs)
        StonePose(0f, offset, 0f, opacity * alpha)
    }
}

private class StonePose(val dx: Float, val dy: Float, val degrees: Float, val alpha: Float)

/** Draws the stones, each moved by [pose]: sideways and vertical offset, extra degrees, opacity. */
@Composable
private fun CairnStones(
    modifier: Modifier,
    onLight: Boolean,
    crop: Rect,
    pose: (Int, Cairn.Stone) -> StonePose
) {
    Canvas(modifier.clipToBounds()) {
        val scale = min(size.width, size.height) / crop.width
        translate((size.width - crop.width * scale) / 2, (size.height - crop.height * scale) / 2) {
            scale(scale, scale, pivot = Offset.Zero) {
                translate(-crop.left, -crop.top) {
                    Cairn.stones.forEachIndexed { index, stone ->
                        val moved = pose(index, stone)
                        val color = when {
                            index == Cairn.stones.lastIndex -> Cairn.Orange
                            onLight -> Cairn.Slate
                            else -> Cairn.Cream
                        }
                        translate(moved.dx, moved.dy) {
                            rotate(stone.degrees + moved.degrees, stone.pivot) {
                                drawRoundRect(
                                    color = color,
                                    topLeft = stone.rect.topLeft,
                                    size = stone.rect.size,
                                    cornerRadius = CornerRadius(stone.rect.height / 2),
                                    alpha = moved.alpha
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

/** Looping loader: the stones stack, the stack clears, repeat. */
@Composable
fun CairnLoader(modifier: Modifier = Modifier, onLight: Boolean = true, crop: Rect = Cairn.crop) {
    val reduceMotion = rememberReduceMotion()
    val elapsed by rememberElapsedMillis(paused = reduceMotion)
    val t = if (reduceMotion) Cairn.SETTLED_MS else elapsed % Cairn.PERIOD_MS
    val fade = if (t < Cairn.FADE_START_MS) 1f
    else 1f - (t - Cairn.FADE_START_MS).toFloat() / (Cairn.PERIOD_MS - Cairn.FADE_START_MS)
    CairnMark(
        elapsedMs = t,
        modifier = modifier.semantics { contentDescription = "Loading" },
        alpha = fade,
        onLight = onLight,
        crop = crop
    )
}

/** Small inline loader: the rows separate, shake out of phase, and settle. Animations off shows the plain stack. */
@Composable
fun CairnShakeLoader(modifier: Modifier = Modifier, onLight: Boolean = true) {
    val reduceMotion = rememberReduceMotion()
    val elapsed by rememberElapsedMillis(paused = reduceMotion)
    val t = if (reduceMotion) 0L else elapsed
    CairnStones(modifier.semantics { contentDescription = "Loading" }, onLight, Cairn.shakeCrop) { index, _ ->
        val pose = Cairn.shakePose(index, t)
        StonePose(pose.dx, pose.dy, pose.degrees, 1f)
    }
}

/** Plays one stack over the launch colour, then fades out. */
@Composable
fun LaunchSplash(onFinished: () -> Unit) {
    val reduceMotion = rememberReduceMotion()
    val elapsed by rememberElapsedMillis(paused = reduceMotion)
    val visibility = remember { Animatable(1f) }
    LaunchedEffect(Unit) {
        delay(Cairn.SETTLED_MS + 250)
        visibility.animateTo(0f, tween(durationMillis = 300))
        onFinished()
    }
    Box(
        modifier = Modifier
            .fillMaxSize()
            .graphicsLayer { alpha = visibility.value }
            .background(Cairn.LaunchBackground)
            .clearAndSetSemantics {},
        contentAlignment = Alignment.Center
    ) {
        CairnMark(elapsedMs = if (reduceMotion) Cairn.SETTLED_MS else elapsed, modifier = Modifier.size(160.dp))
    }
}

/** Infinite-animation frames, so Compose UI tests can still reach idle while a loader is on screen. */
@Composable
private fun rememberElapsedMillis(paused: Boolean): State<Long> = produceState(0L, paused) {
    if (paused) return@produceState
    val start = withInfiniteAnimationFrameMillis { it }
    while (true) {
        withInfiniteAnimationFrameMillis { value = it - start }
    }
}

/** Animations off in developer options is the closest Android has to Reduce Motion. */
@Composable
private fun rememberReduceMotion(): Boolean {
    val resolver = LocalContext.current.contentResolver
    return remember(resolver) {
        Settings.Global.getFloat(resolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
    }
}
