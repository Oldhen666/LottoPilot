# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# react-native-reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# Add any project specific keep options here:

# ML Kit text recognition (only applies when android.enableMinifyInReleaseBuilds=true)
-keep class com.google.mlkit.** { *; }
-keep class expo.modules.mlkitocr.** { *; }

# Ads, billing, and document scan use reflection / JNI entry points.
-keep class io.invertase.googlemobileads.** { *; }
-keep class com.android.billingclient.** { *; }
-keep class com.margelo.nitro.iap.** { *; }
-keep class com.reactnativedocumentscanner.** { *; }
