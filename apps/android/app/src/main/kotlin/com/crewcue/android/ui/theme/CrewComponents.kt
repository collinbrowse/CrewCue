package com.crewcue.android.ui.theme

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.crewcue.android.R
import java.text.DateFormat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/** Warm ground with a faint primary wash. */
@Composable
fun CrewBackground(modifier: Modifier = Modifier, content: @Composable BoxScope.() -> Unit) {
    val colors = MaterialTheme.colorScheme
    Box(
        modifier
            .background(colors.background)
            .background(
                Brush.radialGradient(
                    colors = listOf(colors.primary.copy(alpha = 0.10f), Color.Transparent),
                    center = androidx.compose.ui.geometry.Offset(Float.POSITIVE_INFINITY, 0f),
                    radius = 1100f
                )
            )
    ) {
        CompositionLocalProvider(LocalContentColor provides colors.onBackground) {
            content()
        }
    }
}

/** Avatar, CrewCue wordmark, and settings. Solid surface on Android (no blur). */
@Composable
fun CrewTopBar(onSettings: (() -> Unit)?, modifier: Modifier = Modifier) {
    val colors = MaterialTheme.colorScheme
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.large,
        color = colors.surfaceContainerLowest.copy(alpha = if (LocalCrewExtras.current.dark) 0.92f else 0.96f),
        shadowElevation = 3.dp
    ) {
        Row(
            Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Image(
                painter = painterResource(R.drawable.onboarding_runner),
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier
                    .size(40.dp)
                    .clip(CircleShape)
                    .background(colors.onSurface)
                    .border(2.dp, colors.primary, CircleShape)
            )
            Text(
                "CrewCue",
                modifier = Modifier.padding(start = 12.dp).weight(1f),
                style = MaterialTheme.typography.headlineSmall,
                color = colors.primary
            )
            if (onSettings != null) {
                IconButton(
                    onClick = onSettings,
                    modifier = Modifier
                        .size(44.dp)
                        .background(colors.surfaceContainerHigh, CircleShape)
                        .semantics { contentDescription = "Settings" }
                ) {
                    Icon(Icons.Outlined.Settings, contentDescription = null, tint = colors.primary)
                }
            }
        }
    }
}

enum class ChipStyle { Filled, Soft, Surface, Secondary }

/** Capsule status chip, e.g. ON TRACK or LAST PING. */
@Composable
fun StatusChip(text: String, style: ChipStyle = ChipStyle.Soft, dot: Boolean = false, modifier: Modifier = Modifier) {
    val colors = MaterialTheme.colorScheme
    val (fill, ink) = when (style) {
        ChipStyle.Filled -> colors.primary to colors.onPrimary
        ChipStyle.Soft -> colors.primaryContainer to colors.onPrimaryContainer
        ChipStyle.Surface -> colors.surfaceContainerLowest to colors.primary
        ChipStyle.Secondary -> colors.secondary to colors.onSecondary
    }
    Surface(
        modifier = modifier.semantics { contentDescription = text },
        shape = CircleShape,
        color = fill,
        shadowElevation = if (style == ChipStyle.Surface) 2.dp else 0.dp
    ) {
        Row(Modifier.padding(horizontal = 14.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            if (dot) {
                Box(Modifier.size(7.dp).background(if (style == ChipStyle.Filled) ink else colors.primary, CircleShape))
                Spacer(Modifier.width(6.dp))
            }
            Text(text.uppercase(), style = MaterialTheme.typography.labelSmall, color = ink, maxLines = 1)
        }
    }
}

/** Caps caption over a large value. */
@Composable
fun MetricColumn(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    caption: String? = null,
    alignment: Alignment.Horizontal = Alignment.CenterHorizontally,
    valueColor: Color = MaterialTheme.colorScheme.onSurface
) {
    Column(modifier.semantics(mergeDescendants = true) {}, horizontalAlignment = alignment) {
        Text(
            label.uppercase(),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = when (alignment) {
                Alignment.Start -> androidx.compose.ui.text.style.TextAlign.Start
                Alignment.End -> androidx.compose.ui.text.style.TextAlign.End
                else -> androidx.compose.ui.text.style.TextAlign.Center
            }
        )
        Text(
            value,
            modifier = Modifier.padding(top = 6.dp),
            style = MetricStyle,
            color = valueColor,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
        if (caption != null) {
            Text(caption.uppercase(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
fun CrewProgressBar(fraction: Float, modifier: Modifier = Modifier, height: Dp = 10.dp) {
    val colors = MaterialTheme.colorScheme
    val clamped = fraction.coerceIn(0f, 1f)
    Box(
        modifier
            .fillMaxWidth()
            .height(height)
            .clip(CircleShape)
            .background(colors.surfaceContainerHighest)
            .semantics { contentDescription = "Progress ${(clamped * 100).toInt()} percent" }
    ) {
        if (clamped > 0f) {
            Box(
                Modifier
                    .fillMaxWidth(clamped)
                    .fillMaxHeight()
                    .clip(CircleShape)
                    .background(colors.primary)
            )
        }
    }
}

/** Round floating button for map controls. */
@Composable
fun CircleIconButton(icon: ImageVector, label: String, onClick: () -> Unit, modifier: Modifier = Modifier, size: Dp = 52.dp) {
    Surface(
        onClick = onClick,
        modifier = modifier.size(size).semantics { contentDescription = label },
        shape = CircleShape,
        color = MaterialTheme.colorScheme.surfaceContainerLowest,
        shadowElevation = 4.dp
    ) {
        Box(contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
        }
    }
}

@Composable
fun IconDisc(icon: ImageVector, tint: Color = MaterialTheme.colorScheme.primary) {
    Box(
        Modifier
            .size(40.dp)
            .background(MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.7f), CircleShape),
        contentAlignment = Alignment.Center
    ) {
        Icon(icon, contentDescription = null, tint = tint)
    }
}

/** Tappable row with an icon disc, title, detail, and chevron. */
@Composable
fun CrewListRow(
    icon: ImageVector,
    title: String,
    onClick: () -> Unit,
    detail: String? = null,
    tint: Color = MaterialTheme.colorScheme.primary,
    titleColor: Color = MaterialTheme.colorScheme.onSurface
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .clickable(role = Role.Button, onClick = onClick)
            .padding(vertical = 8.dp)
            .semantics(mergeDescendants = true) { contentDescription = title },
        verticalAlignment = Alignment.CenterVertically
    ) {
        IconDisc(icon, tint)
        Column(Modifier.weight(1f).padding(start = 12.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium, color = titleColor)
            if (!detail.isNullOrBlank()) {
                Text(detail, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Icon(
            Icons.AutoMirrored.Filled.KeyboardArrowRight,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.outline
        )
    }
}

@Composable
fun SectionHeader(title: String, modifier: Modifier = Modifier) {
    Kicker(title, modifier = modifier.fillMaxWidth().semantics { heading() })
}

/** Modal sheet for secondary tools, on the warm ground with 40dp corners. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ToolSheet(title: String, onDismiss: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        shape = RoundedCornerShape(topStart = 40.dp, topEnd = 40.dp),
        containerColor = MaterialTheme.colorScheme.background
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = CrewSpace.gutter)
                .padding(bottom = CrewSpace.stackLg)
                .navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(CrewSpace.gutter)
        ) {
            Text(title, style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { heading() })
            content()
        }
    }
}

/** Input with the DESIGN.md treatment: card fill, hairline edge, blue focus. */
@Composable
fun CrewTextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    singleLine: Boolean = true,
    minLines: Int = 1,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default
) {
    val colors = MaterialTheme.colorScheme
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label) },
        singleLine = singleLine,
        minLines = minLines,
        keyboardOptions = keyboardOptions,
        shape = MaterialTheme.shapes.small,
        colors = OutlinedTextFieldDefaults.colors(
            focusedContainerColor = colors.surfaceContainerLowest,
            unfocusedContainerColor = colors.surfaceContainerLowest,
            focusedBorderColor = colors.secondary,
            unfocusedBorderColor = colors.outlineVariant
        ),
        modifier = modifier.fillMaxWidth().semantics { contentDescription = label }
    )
}

/** Local wall-clock rendering for API instants, e.g. 4:15 PM. */
object CrewClock {
    private val parsers = listOf("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", "yyyy-MM-dd'T'HH:mm:ss'Z'")

    fun short(iso: String?): String? {
        if (iso.isNullOrBlank()) return null
        val date = parse(iso) ?: return null
        return DateFormat.getTimeInstance(DateFormat.SHORT).format(date)
    }

    private fun parse(iso: String): Date? {
        for (pattern in parsers) {
            val format = SimpleDateFormat(pattern, Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
            runCatching { format.parse(iso) }.getOrNull()?.let { return it }
        }
        return null
    }
}
