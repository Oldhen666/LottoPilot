# 如何获取 LottoPilot 日志以便排查问题

## 1. 调试 Alert（已添加）

当前在 **Strategy Lab** 和 **Settings** 中点击「Start 1-month free trial」时，会先弹出 **Debug** 对话框，显示：
- `Handler called` / `Astronaut handler`：说明按钮 `onPress` 已被触发
- `isSignedIn` / `signedIn`：是否已登录
- `IAP`：是否为真机（true）还是 Web/模拟器（false）

**请反馈：**
- **Strategy Lab**：弹窗里点「Start」后，是否有 Debug 弹窗？
- **Settings**：点「Start 1-month free trial」后，是否有 Debug 弹窗？

- 若**有** Debug 弹窗：说明按钮能触发，问题在后续逻辑（登录校验、IAP 调用等）
- 若**没有** Debug 弹窗：说明点击没被识别，可能是触摸/Modal 问题

---

## 2. 用 ADB 获取 Android 日志

1. 用 USB 连接手机，开启开发者选项与 USB 调试
2. 打开命令行，进入项目目录
3. 运行：

```bash
adb logcat -s ReactNativeJS:V *:S
```

或更详细：

```bash
adb logcat | findstr /i "LottoPilot ReactNativeJS IAP"
```

4. 在手机上复现问题（点击按钮）
5. 把终端里出现的相关输出复制发给我

---

## 3. 在 Android Studio 中查看 Logcat

1. 打开 Android Studio
2. 连接手机，选择设备
3. 底部打开 **Logcat**
4. 在过滤框输入：`ReactNativeJS` 或包名
5. 复现问题，复制相关日志

---

## 4. Google Play 配置检查

若 Debug 弹窗能出现，但购买无反应，可能是 Play Console 配置问题：

- **商品是否创建**：Play Console → 应用 → 盈利 → 商品 → 是否有 `lottopilot_astronaut_monthly`？
- **商品状态**：是否为「有效」、已审核通过？
- **Active base plans 必须 > 0**：订阅列表若显示「0 Active base plans」，说明没有可用的 base plan，购买会失败。需进入订阅详情，添加并激活「monthly」base plan，再配置「month-free-trial」offer。
- **测试轨道**：应用是否已上传到内部/封闭测试轨道？
- **许可测试**：Play Console → 设置 → 许可测试 → 你的测试邮箱是否在列表中？
- **签名**：安装的 APK/AAB 是否与上传到 Play 的签名一致？

---

## 5. 调试完成后的处理

问题定位后，请删除代码中的 Debug Alert（避免发给用户）：
- `StrategyLabScreen.tsx` 中 `handlePurchasePro` 开头的 `Alert.alert('Debug', ...)`
- `SettingsScreen.tsx` 中 `handleUpgradeAstronaut` 开头的 `Alert.alert('Debug', ...)`
