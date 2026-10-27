# R8 rules for the CrewCue release build. Library rules (Auth0, MapLibre, Stream) ship with their AARs.

# JNI facade for packages/client-core. The Swift .so binds these names at load time.
-keep class com.crewcue.clientcore.** { *; }
-keepclasseswithmembernames,includedescriptorclasses class * {
    native <methods>;
}

# Optional SDK bootstraps, loaded by name from MainActivity.
-keep class com.crewcue.android.ui.map.MapLibreBootstrap { public static *; }
-keep class com.crewcue.android.ui.chat.StreamChatBootstrap { public static *; }

# Push registration reaches Firebase by reflection. Firebase is not a dependency yet.
-dontwarn com.google.firebase.**
-dontwarn com.google.android.gms.**
