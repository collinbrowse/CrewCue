# R8 rules for the CrewCue release build. Library rules (Auth0, MapLibre, Firebase) ship with their AARs.

# JNI facade for packages/client-core. The Swift .so binds these names at load time.
-keep class com.crewcue.clientcore.** { *; }
-keepclasseswithmembernames,includedescriptorclasses class * {
    native <methods>;
}

# Optional SDK bootstraps, loaded by name from MainActivity.
-keep class com.crewcue.android.ui.map.MapLibreBootstrap { public static *; }
