package com.crewcue.android.crash

/**
 * Strips credentials and personal data from Sentry payloads before they leave the phone.
 * Same rules as the API (`services/api/src/lib/errorScrub.ts`): no tokens, emails,
 * precise lat/lng or query strings.
 */
object CrashScrub {
    const val FILTERED = "[Filtered]"

    private val sensitiveKey = Regex(
        "^(?:.*(?:token|secret|password|authorization|cookie|email|session)|lat|lng|lon|latitude|longitude|coords?|coordinates?|location|position|accuracy|altitude)$",
        RegexOption.IGNORE_CASE,
    )

    private val patterns = listOf(
        Regex("Bearer\\s+[A-Za-z0-9._~+/=-]+", RegexOption.IGNORE_CASE) to "Bearer $FILTERED",
        Regex("eyJ[A-Za-z0-9_-]{5,}\\.[A-Za-z0-9_-]{5,}\\.[A-Za-z0-9_-]*") to FILTERED,
        Regex("[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}", RegexOption.IGNORE_CASE) to FILTERED,
        Regex("-?\\d{1,3}\\.\\d{3,}\\s*,\\s*-?\\d{1,3}\\.\\d{3,}") to FILTERED,
        Regex("(/[^\\s?\"']*)\\?[^\\s\"']*") to "$1",
    )

    fun isSensitiveKey(key: String): Boolean = sensitiveKey.matches(key)

    fun text(value: String?): String? {
        var out = value ?: return null
        for ((regex, replacement) in patterns) out = regex.replace(out, replacement)
        return out
    }

    fun url(value: String): String = value.substringBefore('?')

    fun map(data: Map<String, Any?>): MutableMap<String, Any?> {
        val out = linkedMapOf<String, Any?>()
        for ((key, value) in data) {
            out[key] = when {
                isSensitiveKey(key) -> FILTERED
                key == "url" && value is String -> url(value)
                value is String -> text(value)
                value is Map<*, *> -> map(value.entries.associate { it.key.toString() to it.value })
                else -> value
            }
        }
        return out
    }
}
