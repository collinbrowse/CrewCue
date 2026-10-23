package com.crewcue.android.ui.map

import android.content.Context
import android.graphics.Color
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.crewcue.android.BuildConfig
import org.json.JSONArray
import org.json.JSONObject
import org.maplibre.android.MapLibre
import org.maplibre.android.WellKnownTileServer
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.geometry.LatLngBounds
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import org.maplibre.android.style.expressions.Expression
import org.maplibre.android.style.layers.CircleLayer
import org.maplibre.android.style.layers.LineLayer
import org.maplibre.android.style.layers.PropertyFactory
import org.maplibre.android.style.layers.SymbolLayer
import org.maplibre.android.style.sources.GeoJsonSource
import org.maplibre.android.tile.TileOperation

private const val FALLBACK_STYLE_URL = "https://demotiles.maplibre.org/style.json"

/** MapTiler topo when `crewcue_maptiler_key` is set in local.properties, else the demo style. */
private fun styleUrl(dark: Boolean): String {
    val key = BuildConfig.MAPTILER_KEY.trim()
    if (key.isEmpty()) return FALLBACK_STYLE_URL
    val style = if (dark) "topo-v2-dark" else "topo-v2"
    return "https://api.maptiler.com/maps/$style/style.json?key=$key"
}

private fun Context.isDarkMode(): Boolean =
    (resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK) ==
        android.content.res.Configuration.UI_MODE_NIGHT_YES
private const val LINE_SOURCE = "crewcue-course"
private const val LINE_LAYER = "crewcue-course-line"
private const val POINT_SOURCE = "crewcue-checkpoints"
private const val CIRCLE_LAYER = "crewcue-checkpoint-circles"
private const val TITLE_LAYER = "crewcue-checkpoint-titles"

object MapLibreBootstrap {
    @JvmStatic
    fun install(context: Context) {
        if (!MapLibre.hasInstance()) {
            MapLibre.getInstance(context.applicationContext, "", WellKnownTileServer.MapLibre)
        }
        CourseMaps.renderer = MapLibreCourseRenderer()
    }
}

private class MapLibreCourseRenderer : CourseMapRenderer {
    @Composable
    override fun Render(
        points: List<MapCheckpoint>,
        line: List<CoursePoint>,
        modifier: Modifier,
        onMapTap: (Double, Double) -> Unit,
        onStyleReady: () -> Unit,
        onStyleFailed: () -> Unit,
        onTilesUnavailable: () -> Unit,
        recenterRequest: Int
    ) {
        val context = LocalContext.current
        val dark = context.isDarkMode()
        val palette = remember(dark) { CoursePalette(dark) }
        val paletteState = rememberUpdatedState(palette)
        val lifecycle = LocalLifecycleOwner.current.lifecycle
        val tap = rememberUpdatedState(onMapTap)
        val ready = rememberUpdatedState(onStyleReady)
        val failed = rememberUpdatedState(onStyleFailed)
        val tilesUnavailable = rememberUpdatedState(onTilesUnavailable)
        val pointState = rememberUpdatedState(points)
        val lineState = rememberUpdatedState(line)
        val framed = remember { booleanArrayOf(false) }
        val mapView = remember(context) {
            if (!MapLibre.hasInstance()) {
                MapLibre.getInstance(context.applicationContext, "", WellKnownTileServer.MapLibre)
            }
            MapView(context).also { view ->
                view.onCreate(null)
                view.addOnDidFailLoadingMapListener { message ->
                    if (!context.isOnline() || message.looksOffline()) {
                        tilesUnavailable.value()
                    } else {
                        failed.value()
                    }
                }
                view.addOnTileActionListener { operation, _, _, _, _, _, _ ->
                    if (operation == TileOperation.Error && !context.isOnline()) {
                        tilesUnavailable.value()
                    }
                }
                view.getMapAsync { map ->
                    map.addOnMapClickListener { latLng ->
                        tap.value(latLng.latitude, latLng.longitude)
                        true
                    }
                    if (!context.isOnline()) tilesUnavailable.value()
                    map.uiSettings.isLogoEnabled = false
                    map.uiSettings.setAttributionMargins(48, 420, 0, 0)
                    map.uiSettings.attributionGravity = android.view.Gravity.TOP or android.view.Gravity.START
                    map.setStyle(Style.Builder().fromUri(styleUrl(dark))) { style ->
                        ready.value()
                        runCatching { draw(style, map, lineState.value, pointState.value, framed, paletteState.value) }
                    }
                }
            }
        }
        DisposableEffect(lifecycle, mapView) {
            val observer = LifecycleEventObserver { _, event ->
                when (event) {
                    Lifecycle.Event.ON_START -> mapView.onStart()
                    Lifecycle.Event.ON_RESUME -> mapView.onResume()
                    Lifecycle.Event.ON_PAUSE -> mapView.onPause()
                    Lifecycle.Event.ON_STOP -> mapView.onStop()
                    else -> Unit
                }
            }
            lifecycle.addObserver(observer)
            mapView.onStart()
            onDispose {
                lifecycle.removeObserver(observer)
                mapView.onPause()
                mapView.onStop()
                if (!mapView.isDestroyed) mapView.onDestroy()
            }
        }
        AndroidView(
            factory = { mapView },
            modifier = modifier.semantics { contentDescription = "Course map" },
            update = { view ->
                view.getMapAsync { map ->
                    val style = map.style ?: return@getMapAsync
                    runCatching { draw(style, map, line, points, framed, palette) }
                }
            }
        )
        LaunchedEffect(recenterRequest) {
            if (recenterRequest == 0) return@LaunchedEffect
            mapView.getMapAsync { map ->
                val framePoints = if (lineState.value.size >= 2) {
                    lineState.value
                } else {
                    pointState.value.map { CoursePoint(it.latitude, it.longitude) }
                }
                if (framePoints.isNotEmpty()) frame(map, framePoints, context)
            }
        }
    }
}

private fun draw(
    style: Style,
    map: MapLibreMap,
    line: List<CoursePoint>,
    points: List<MapCheckpoint>,
    framed: BooleanArray,
    palette: CoursePalette
) {
    if (line.size >= 2) {
        val geoJson = lineGeoJson(line)
        val existing = style.getSource(LINE_SOURCE) as? GeoJsonSource
        if (existing == null) {
            style.addSource(GeoJsonSource(LINE_SOURCE, geoJson))
            style.addLayer(
                LineLayer(LINE_LAYER, LINE_SOURCE).withProperties(
                    PropertyFactory.lineColor(palette.line),
                    PropertyFactory.lineWidth(5f),
                    PropertyFactory.lineCap("round"),
                    PropertyFactory.lineJoin("round")
                )
            )
        } else {
            existing.setGeoJson(geoJson)
        }
    }
    if (points.isNotEmpty()) {
        val geoJson = pointGeoJson(points)
        val existing = style.getSource(POINT_SOURCE) as? GeoJsonSource
        if (existing == null) {
            style.addSource(GeoJsonSource(POINT_SOURCE, geoJson))
            style.addLayer(
                CircleLayer(CIRCLE_LAYER, POINT_SOURCE).withProperties(
                    PropertyFactory.circleRadius(7f),
                    PropertyFactory.circleColor(palette.marker),
                    PropertyFactory.circleStrokeColor(palette.line),
                    PropertyFactory.circleStrokeWidth(2.5f)
                )
            )
            style.addLayer(
                SymbolLayer(TITLE_LAYER, POINT_SOURCE).withProperties(
                    PropertyFactory.textField(Expression.get("title")),
                    PropertyFactory.textSize(12f),
                    PropertyFactory.textOffset(arrayOf(0f, 1.4f)),
                    PropertyFactory.textColor(palette.label),
                    PropertyFactory.textHaloColor(palette.halo),
                    PropertyFactory.textHaloWidth(2f)
                )
            )
        } else {
            existing.setGeoJson(geoJson)
        }
    }
    val framePoints = if (line.size >= 2) line else points.map { CoursePoint(it.latitude, it.longitude) }
    if (!framed[0] && framePoints.isNotEmpty()) {
        frame(map, framePoints, null)
        framed[0] = true
    }
}

/** Course colors on the map: Night Trail primary line, white markers with dark labels. */
private class CoursePalette(dark: Boolean) {
    val line = Color.parseColor(if (dark) "#C9BFFF" else "#5440B9")
    val marker = Color.parseColor(if (dark) "#20201B" else "#FFFFFF")
    val label = Color.parseColor(if (dark) "#E5E2DA" else "#1C1C17")
    val halo = Color.parseColor(if (dark) "#14140F" else "#FFFFFF")
}

private fun frame(map: MapLibreMap, points: List<CoursePoint>, context: Context?) {
    val first = points.first()
    val same = points.all { it.latitude == first.latitude && it.longitude == first.longitude }
    if (points.size == 1 || same) {
        map.moveCamera(CameraUpdateFactory.newLatLngZoom(LatLng(first.latitude, first.longitude), 13.0))
        return
    }
    val bounds = LatLngBounds.Builder()
        .includes(points.map { LatLng(it.latitude, it.longitude) })
        .build()
    // Leave room for the top bar and chips above and the aid sheet below.
    val density = context?.resources?.displayMetrics?.density ?: 2.75f
    val update = CameraUpdateFactory.newLatLngBounds(
        bounds,
        (48 * density).toInt(),
        (200 * density).toInt(),
        (96 * density).toInt(),
        (360 * density).toInt()
    )
    if (context != null) map.animateCamera(update) else map.moveCamera(update)
}

private fun lineGeoJson(line: List<CoursePoint>): String {
    val coordinates = JSONArray()
    line.forEach { point ->
        coordinates.put(JSONArray().put(point.longitude).put(point.latitude))
    }
    return JSONObject()
        .put("type", "Feature")
        .put("properties", JSONObject())
        .put(
            "geometry",
            JSONObject().put("type", "LineString").put("coordinates", coordinates)
        )
        .toString()
}

private fun pointGeoJson(points: List<MapCheckpoint>): String {
    val features = JSONArray()
    points.forEach { point ->
        features.put(
            JSONObject()
                .put("type", "Feature")
                .put("properties", JSONObject().put("title", point.title))
                .put(
                    "geometry",
                    JSONObject()
                        .put("type", "Point")
                        .put("coordinates", JSONArray().put(point.longitude).put(point.latitude))
                )
        )
    }
    return JSONObject().put("type", "FeatureCollection").put("features", features).toString()
}
