package com.crewcue.android.ui.map

import android.content.Context
import android.graphics.Color
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
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

private const val STYLE_URL = "https://demotiles.maplibre.org/style.json"
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
        onTilesUnavailable: () -> Unit
    ) {
        val context = LocalContext.current
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
                    map.setStyle(Style.Builder().fromUri(STYLE_URL)) { style ->
                        ready.value()
                        runCatching { draw(style, map, lineState.value, pointState.value, framed) }
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
                    runCatching { draw(style, map, line, points, framed) }
                }
            }
        )
    }
}

private fun draw(
    style: Style,
    map: MapLibreMap,
    line: List<CoursePoint>,
    points: List<MapCheckpoint>,
    framed: BooleanArray
) {
    if (line.size >= 2) {
        val geoJson = lineGeoJson(line)
        val existing = style.getSource(LINE_SOURCE) as? GeoJsonSource
        if (existing == null) {
            style.addSource(GeoJsonSource(LINE_SOURCE, geoJson))
            style.addLayer(
                LineLayer(LINE_LAYER, LINE_SOURCE).withProperties(
                    PropertyFactory.lineColor(Color.parseColor("#1B6CA8")),
                    PropertyFactory.lineWidth(4f)
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
                    PropertyFactory.circleRadius(6f),
                    PropertyFactory.circleColor(Color.parseColor("#C2410C"))
                )
            )
            style.addLayer(
                SymbolLayer(TITLE_LAYER, POINT_SOURCE).withProperties(
                    PropertyFactory.textField(Expression.get("title")),
                    PropertyFactory.textSize(12f),
                    PropertyFactory.textColor(Color.parseColor("#102027"))
                )
            )
        } else {
            existing.setGeoJson(geoJson)
        }
    }
    val framePoints = if (line.size >= 2) line else points.map { CoursePoint(it.latitude, it.longitude) }
    if (!framed[0] && framePoints.isNotEmpty()) {
        frame(map, framePoints)
        framed[0] = true
    }
}

private fun frame(map: MapLibreMap, points: List<CoursePoint>) {
    val first = points.first()
    val same = points.all { it.latitude == first.latitude && it.longitude == first.longitude }
    if (points.size == 1 || same) {
        map.moveCamera(CameraUpdateFactory.newLatLngZoom(LatLng(first.latitude, first.longitude), 13.0))
        return
    }
    val bounds = LatLngBounds.Builder()
        .includes(points.map { LatLng(it.latitude, it.longitude) })
        .build()
    map.moveCamera(CameraUpdateFactory.newLatLngBounds(bounds, 72))
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
