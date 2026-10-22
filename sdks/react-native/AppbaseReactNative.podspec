require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

# Native build-environment detection for @appbasehq/react-native. Autolinked by React Native and Expo.
Pod::Spec.new do |s|
  s.name = 'AppbaseReactNative'
  s.version = package['version']
  s.summary = 'Build detection (Development, TestFlight, App Store) and the privacy manifest for Appbase analytics.'
  s.homepage = 'https://appbase.so'
  s.license = { :type => 'MIT', :file => 'LICENSE' }
  s.author = 'Appbase'
  s.platforms = { :ios => '15.1' }
  s.source = { :git => 'https://github.com/appbasehq/appbase-react-native.git', :tag => "v#{s.version}" }
  s.source_files = 'ios/*.{m,swift}'
  # What the SDK collects, for the app's merged privacy report; identical to the Swift SDK's.
  s.resource_bundles = { 'AppbaseReactNativePrivacy' => ['ios/PrivacyInfo.xcprivacy'] }
  s.swift_version = '5.9'
  s.frameworks = 'StoreKit'
  if respond_to?(:install_modules_dependencies, true)
    install_modules_dependencies(s)
  else
    s.dependency 'React-Core'
  end
end
