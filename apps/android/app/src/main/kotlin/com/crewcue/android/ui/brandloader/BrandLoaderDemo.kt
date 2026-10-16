package com.crewcue.android.ui.brandloader

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.crewcue.android.ui.brand.Cairn
import com.crewcue.android.ui.brand.CairnLoader
import com.crewcue.android.ui.brand.CairnShakeLoader
import com.crewcue.android.ui.theme.PrimaryButton

/** Fixture for the brand loader: the animated app icon, a standalone loader, an inline spinner, and the shake loaders. */
@Composable
fun BrandLoaderDemo(title: String) {
    Column(modifier = Modifier.padding(top = 24.dp), verticalArrangement = Arrangement.spacedBy(24.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(28.dp), verticalAlignment = Alignment.CenterVertically) {
            CairnLoader(
                modifier = Modifier
                    .size(120.dp)
                    .clip(RoundedCornerShape(27.dp))
                    .background(Brush.verticalGradient(listOf(Cairn.Slate, Cairn.SlateDeep))),
                onLight = false,
                crop = Cairn.iconCrop
            )
            CairnLoader(modifier = Modifier.size(96.dp))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            CairnLoader(modifier = Modifier.size(24.dp))
            Text(title)
        }
        Row(
            modifier = Modifier.testTag("crewcue.loader-shake"),
            horizontalArrangement = Arrangement.spacedBy(28.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            CairnShakeLoader(modifier = Modifier.size(64.dp))
            CairnShakeLoader(modifier = Modifier.size(24.dp))
            CairnShakeLoader(modifier = Modifier.size(16.dp))
        }
        PrimaryButton("Recalculate", onClick = {}, busy = true)
    }
}
