// The background location task must be defined at the top level of the bundle, before the
// router mounts, so it also exists when the OS starts the app in the background without UI.
import './src/lib/location-task';
import 'expo-router/entry';
