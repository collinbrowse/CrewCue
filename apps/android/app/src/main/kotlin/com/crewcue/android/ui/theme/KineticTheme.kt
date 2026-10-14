package com.crewcue.android.ui.theme

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

private val Olive = Color(0xFF506600)
private val Lime = Color(0xFFCCFF00)
private val OnLime = Color(0xFF5B7300)
private val Ink = Color(0xFF1C1B1B)
private val Body = Color(0xFF444933)
private val Paper = Color(0xFFFCF9F8)
private val Card = Color(0xFFF0EDEC)
private val SecondaryFill = Color(0xFFEBE7E7)
private val Divider = Color(0xFFC4C9AC)
private val Danger = Color(0xFFBA1A1A)

private val Night = Color(0xFF131313)
private val NightCard = Color(0xFF201F1F)
private val NightInk = Color(0xFFE5E2E1)
private val NightBody = Color(0xFFC4C9AC)
private val NightLime = Color(0xFFC3F400)

private val LightColors = lightColorScheme(
    primary = Olive,
    onPrimary = Color.White,
    primaryContainer = Lime,
    onPrimaryContainer = OnLime,
    secondary = Color(0xFFA33800),
    onSecondary = Color.White,
    secondaryContainer = SecondaryFill,
    onSecondaryContainer = Ink,
    background = Paper,
    onBackground = Ink,
    surface = Paper,
    onSurface = Ink,
    surfaceVariant = Card,
    onSurfaceVariant = Body,
    surfaceContainer = Card,
    surfaceContainerHigh = SecondaryFill,
    outline = Color(0xFF747A60),
    outlineVariant = Divider,
    error = Danger,
    onError = Color.White
)

private val DarkColors = darkColorScheme(
    primary = NightLime,
    onPrimary = Color(0xFF283500),
    primaryContainer = NightLime,
    onPrimaryContainer = Color(0xFF556D00),
    background = Night,
    onBackground = NightInk,
    surface = Night,
    onSurface = NightInk,
    surfaceVariant = NightCard,
    onSurfaceVariant = NightBody,
    surfaceContainer = NightCard,
    surfaceContainerHigh = Color(0xFF2A2A2A),
    outline = Color(0xFF8E9379),
    outlineVariant = Color(0xFF444933),
    error = Color(0xFFFFB4AB),
    onError = Color(0xFF690005)
)

@Composable
fun CrewCueTheme(content: @Composable () -> Unit) {
    val dark = androidx.compose.foundation.isSystemInDarkTheme()
    MaterialTheme(
        colorScheme = if (dark) DarkColors else LightColors,
        content = content
    )
}

@Composable
fun ProductTitle(title: String, subtitle: String, modifier: Modifier = Modifier) {
    Text(
        title,
        modifier = modifier,
        style = MaterialTheme.typography.headlineSmall,
        fontWeight = FontWeight.ExtraBold,
        color = MaterialTheme.colorScheme.onSurface
    )
    if (subtitle.isNotBlank()) {
        Text(
            subtitle,
            modifier = Modifier.padding(top = 6.dp),
            style = MaterialTheme.typography.bodyLarge,
            fontWeight = FontWeight.Medium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
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
            .height(48.dp)
            .semantics { contentDescription = spoken },
        shape = RoundedCornerShape(6.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = MaterialTheme.colorScheme.primary,
            contentColor = MaterialTheme.colorScheme.onPrimary
        )
    ) {
        Text(label, fontWeight = FontWeight.SemiBold)
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
            .height(48.dp)
            .semantics { contentDescription = spoken },
        shape = RoundedCornerShape(6.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
            contentColor = MaterialTheme.colorScheme.onSurface,
            disabledContainerColor = MaterialTheme.colorScheme.surfaceContainerHigh.copy(alpha = 0.5f),
            disabledContentColor = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.4f)
        )
    ) {
        Text(label, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
fun ProductCard(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit
) {
    val colors = MaterialTheme.colorScheme
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(8.dp),
        color = colors.surfaceContainer,
        border = BorderStroke(1.dp, colors.outlineVariant),
        content = {
            Column(Modifier.padding(16.dp), content = content)
        }
    )
}
