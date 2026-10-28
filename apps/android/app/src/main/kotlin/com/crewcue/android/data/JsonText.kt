package com.crewcue.android.data

import org.json.JSONObject

/** Reads a string field, treating a missing or JSON-null value as "". `optString` returns "null" for JSON null. */
fun JSONObject.optText(key: String): String = if (isNull(key)) "" else optString(key)
