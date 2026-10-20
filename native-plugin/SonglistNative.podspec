require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name = 'SonglistNative'
  s.version = package['version']
  s.summary = package['description']
  s.license = 'UNLICENSED'
  s.homepage = 'https://otimo.se'
  s.author = 'OTIMO'
  s.source = { :git => 'https://example.invalid/songlist-native.git', :tag => s.version.to_s }
  s.source_files = 'ios/Sources/**/*.{swift,h,m}'
  s.ios.deployment_target = '15.0'
  s.dependency 'Capacitor'
  s.swift_version = '5.9'
  s.frameworks = 'Vision', 'VisionKit'
end
