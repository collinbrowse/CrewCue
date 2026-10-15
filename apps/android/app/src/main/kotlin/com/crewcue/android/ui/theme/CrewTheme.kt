package com.crewcue.android.ui.theme

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Shapes
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp

// Night Trail. Values mirror `nightTrail` in packages/contracts/src/designSystems.ts.

private val LightColors = lightColorScheme(
    primary = Color(0xFF5440B9),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFE5DEFF),
    onPrimaryContainer = Color(0xFF462FAA),
    inversePrimary = Color(0xFFC9BFFF),
    secondary = Color(0xFF0058BE),
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFEBE8DF),
    onSecondaryContainer = Color(0xFF1C1C17),
    tertiary = Color(0xFF4E5566),
    onTertiary = Color.White,
    background = Color(0xFFFCF9F0),
    onBackground = Color(0xFF1C1C17),
    surface = Color(0xFFFCF9F0),
    onSurface = Color(0xFF1C1C17),
    surfaceVariant = Color(0xFFE5E2DA),
    onSurfaceVariant = Color(0xFF484553),
    surfaceTint = Color(0xFF5E4AC3),
    inverseSurface = Color(0xFF31312B),
    inverseOnSurface = Color(0xFFF4F1E8),
    surfaceContainerLowest = Color.White,
    surfaceContainerLow = Color(0xFFF6F3EA),
    surfaceContainer = Color(0xFFF1EEE5),
    surfaceContainerHigh = Color(0xFFEBE8DF),
    surfaceContainerHighest = Color(0xFFE5E2DA),
    surfaceDim = Color(0xFFDDDAD1),
    surfaceBright = Color(0xFFFCF9F0),
    outline = Color(0xFF797584),
    outlineVariant = Color(0xFFC9C4D5),
    error = Color(0xFFBA1A1A),
    onError = Color.White,
    errorContainer = Color(0xFFFFF1EC),
    onErrorContainer = Color(0xFF93000A)
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFFC9BFFF),
    onPrimary = Color(0xFF2F0C94),
    primaryContainer = Color(0xFF3A2C8A),
    onPrimaryContainer = Color(0xFFE5DEFF),
    inversePrimary = Color(0xFF5E4AC3),
    secondary = Color(0xFFADC6FF),
    onSecondary = Color(0xFF002E6A),
    secondaryContainer = Color(0xFF35352F),
    onSecondaryContainer = Color(0xFFE5E2DA),
    tertiary = Color(0xFFC0C6DB),
    onTertiary = Color(0xFF293040),
    background = Color(0xFF14140F),
    onBackground = Color(0xFFE5E2DA),
    surface = Color(0xFF14140F),
    onSurface = Color(0xFFE5E2DA),
    surfaceVariant = Color(0xFF35352F),
    onSurfaceVariant = Color(0xFFC9C4D5),
    surfaceTint = Color(0xFFC9BFFF),
    inverseSurface = Color(0xFFE5E2DA),
    inverseOnSurface = Color(0xFF31312B),
    surfaceContainerLowest = Color(0xFF0E0E0A),
    surfaceContainerLow = Color(0xFF1C1C17),
    surfaceContainer = Color(0xFF20201B),
    surfaceContainerHigh = Color(0xFF2A2A25),
    surfaceContainerHighest = Color(0xFF35352F),
    surfaceDim = Color(0xFF14140F),
    surfaceBright = Color(0xFF3A3933),
    outline = Color(0xFF938E9F),
    outlineVariant = Color(0xFF484553),
    error = Color(0xFFFFB4AB),
    onError = Color(0xFF690005),
    errorContainer = Color(0xFF3B1A17),
    onErrorContainer = Color(0xFFFFDAD6)
)

/** Type scale from DESIGN.md on the platform sans (Roboto). */
private val CrewTypography = Typography(
    displaySmall = TextStyle(fontSize = 32.sp, lineHeight = 38.sp, fontWeight = FontWeight.Black, letterSpacing = (-0.02).em),
    headlineMedium = TextStyle(fontSize = 28.sp, lineHeight = 34.sp, fontWeight = FontWeight.Bold),
    headlineSmall = TextStyle(fontSize = 24.sp, lineHeight = 30.sp, fontWeight = FontWeight.Bold),
    titleLarge = TextStyle(fontSize = 20.sp, lineHeight = 26.sp, fontWeight = FontWeight.Bold),
    titleMedium = TextStyle(fontSize = 17.sp, lineHeight = 22.sp, fontWeight = FontWeight.SemiBold),
    bodyLarge = TextStyle(fontSize = 17.sp, lineHeight = 25.sp),
    bodyMedium = TextStyle(fontSize = 15.sp, lineHeight = 21.sp),
    labelLarge = TextStyle(fontSize = 16.sp, lineHeight = 20.sp, fontWeight = FontWeight.SemiBold),
    labelMedium = TextStyle(fontSize = 13.sp, lineHeight = 16.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.06.em),
    labelSmall = TextStyle(fontSize = 11.sp, lineHeight = 14.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.14.em)
)

private val CrewShapes = Shapes(
    extraSmall = RoundedCornerShape(8.dp),
    small = RoundedCornerShape(16.dp),
    medium = RoundedCornerShape(24.dp),
    large = RoundedCornerShape(32.dp),
    extraLarge = RoundedCornerShape(40.dp)
)

/** Spacing and radii from DESIGN.md. */
object CrewSpace {
    val base = 8.dp
    val stackSm = 12.dp
    val gutter = 16.dp
    val margin = 24.dp
    val stackLg = 32.dp
    val card = 32.dp
}

/** Colors outside the Material scheme: hero gradient and the soft card shadow tint. */
@Immutable
data class CrewExtras(val heroGradient: List<Color>, val heroAccent: Color, val dark: Boolean)

val LocalCrewExtras = staticCompositionLocalOf {
    CrewExtras(listOf(Color(0xFF1C1A2E), Color(0xFF3A2C8A), Color(0xFF6D5AD3)), Color(0xFFC9BFFF), false)
}

/** Metric numerals: heavy, tabular. */
val MetricStyle = TextStyle(fontSize = 24.sp, lineHeight = 28.sp, fontWeight = FontWeight.Black, fontFeatureSettings = "tnum")
val MetricLargeStyle = TextStyle(fontSize = 30.sp, lineHeight = 34.sp, fontWeight = FontWeight.Black, fontFeatureSettings = "tnum")

@Composable
fun CrewCueTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    androidx.compose.runtime.CompositionLocalProvider(
        LocalCrewExtras provides CrewExtras(
            heroGradient = listOf(Color(0xFF1C1A2E), Color(0xFF3A2C8A), Color(0xFF6D5AD3)),
            heroAccent = Color(0xFFC9BFFF),
            dark = dark
        )
    ) {
        MaterialTheme(
            colorScheme = if (dark) DarkColors else LightColors,
            typography = CrewTypography,
            shapes = CrewShapes,
            content = content
        )
    }
}

@Composable
fun ProductTitle(title: String, subtitle: String, modifier: Modifier = Modifier) {
    Text(
        title,
        modifier = modifier,
        style = MaterialTheme.typography.displaySmall,
        color = MaterialTheme.colorScheme.onSurface
    )
    if (subtitle.isNotBlank()) {
        Text(
            subtitle,
            modifier = Modifier.padding(top = 6.dp),
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

/** Uppercase section kicker with wide tracking. */
@Composable
fun Kicker(text: String, modifier: Modifier = Modifier, color: Color = MaterialTheme.colorScheme.onSurfaceVariant) {
    Text(
        text.uppercase(),
        modifier = modifier,
        style = MaterialTheme.typography.labelSmall,
        color = color,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis
    )
}

@Composable
fun PrimaryButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    spoken: String = label
) {
    Button(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = 52.dp)
            .semantics { contentDescription = spoken },
        shape = CircleShape,
        contentPadding = PaddingValues(horizontal = 20.dp, vertical = 14.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = MaterialTheme.colorScheme.primary,
            contentColor = MaterialTheme.colorScheme.onPrimary,
            disabledContainerColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.4f),
            disabledContentColor = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.8f)
        )
    ) {
        Text(label, style = MaterialTheme.typography.labelLarge, maxLines = 1)
    }
}

@Composable
fun SecondaryButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    spoken: String = label
) {
    Button(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = 52.dp)
            .semantics { contentDescription = spoken },
        shape = CircleShape,
        contentPadding = PaddingValues(horizontal = 20.dp, vertical = 14.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
            contentColor = MaterialTheme.colorScheme.onSurface,
            disabledContainerColor = MaterialTheme.colorScheme.surfaceContainerHigh.copy(alpha = 0.5f),
            disabledContentColor = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.4f)
        )
    ) {
        Text(label, style = MaterialTheme.typography.labelLarge, maxLines = 1)
    }
}

/** Outline capsule for low-emphasis actions such as sign out or join with a code. */
@Composable
fun GhostButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    spoken: String = label
) {
    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = 52.dp)
            .semantics { contentDescription = spoken },
        shape = CircleShape,
        border = BorderStroke(2.dp, MaterialTheme.colorScheme.onSurface),
        colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.onSurface)
    ) {
        Text(label, style = MaterialTheme.typography.labelLarge, maxLines = 1)
    }
}

/** Level-1 card: white on the warm ground, hairline border, soft shadow, 32dp corners. */
@Composable
fun ProductCard(
    modifier: Modifier = Modifier,
    padding: PaddingValues = PaddingValues(CrewSpace.margin),
    content: @Composable ColumnScope.() -> Unit
) {
    val colors = MaterialTheme.colorScheme
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.large,
        color = if (LocalCrewExtras.current.dark) colors.surfaceContainer else colors.surfaceContainerLowest,
        border = BorderStroke(1.dp, colors.outlineVariant.copy(alpha = 0.7f)),
        shadowElevation = 2.dp,
        content = {
            Column(Modifier.padding(padding), content = content)
        }
    )
}
