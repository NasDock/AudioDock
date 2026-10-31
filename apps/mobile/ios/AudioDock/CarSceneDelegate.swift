import CarPlay

/// CarPlay 场景：连接/断开时转发给 RNCarPlay，由 JS 侧构建模板
class CarSceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {

  func templateApplicationScene(
    _ templateApplicationScene: CPTemplateApplicationScene,
    didConnect interfaceController: CPInterfaceController
  ) {
    RNCarPlay.connect(
      with: interfaceController,
      window: templateApplicationScene.carWindow
    )
  }

  func templateApplicationScene(
    _ templateApplicationScene: CPTemplateApplicationScene,
    didDisconnectInterfaceController interfaceController: CPInterfaceController
  ) {
    RNCarPlay.disconnect()
  }
}
