# 自定义 Windows EXE 图标指南

## 准备图标文件

### 1. 图标格式要求
- **文件格式**: `.ico` (Windows Icon)
- **推荐尺寸**: 包含多个尺寸（256x256, 128x128, 64x64, 48x48, 32x32, 16x16）
- **颜色深度**: 32-bit (支持透明背景)

### 2. 在线工具转换
如果你有 PNG/JPG 图片，可以使用以下在线工具转换为 .ico：
- https://www.icoconverter.com/
- https://convertio.co/zh/png-ico/
- https://www.online-convert.com/

### 3. 放置图标文件
将生成的 `.ico` 文件放到以下位置：
```
compile/app-icon.ico
```

## 修改配置

图标会自动应用到：
1. **EXE 主程序图标** - ⭐ **程序文件本身的图标**（文件管理器、任务栏显示）
2. **安装程序图标** - 显示在安装向导窗口
3. **桌面快捷方式图标** - 安装后创建的快捷方式
4. **开始菜单图标** - Windows 开始菜单中的图标

### 技术实现

主程序图标通过 `resedit` NPM 包在 Docker 容器内嵌入到 EXE 文件的 PE 资源中：

```bash
# 1. pkg 打包生成基础 EXE
pkg -c pkg-config.json dist/index.js -o output/app.exe

# 2. 使用 resedit 读取 EXE 和图标文件
node -e "
  const { ResEdit } = require('resedit');
  const fs = require('fs');
  
  // 加载 EXE 文件
  const exe = ResEdit.NtExecutable.from(fs.readFileSync('output/app.exe'));
  const res = ResEdit.NtExecutableResource.from(exe);
  
  // 加载图标文件
  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync('compile/app-icon.ico'));
  
  // 替换图标资源（ID=1, 语言ID=1033/English）
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    res.entries,
    1,      // 图标组 ID
    1033,   // 语言 ID (English US)
    iconFile.icons.map((item) => item.data)
  );
  
  // 写回 EXE
  res.outputResource(exe);
  fs.writeFileSync('output/app.exe', Buffer.from(exe.generate()));
"
```

**优势**：
- ✅ **纯 JavaScript 实现**，无需 wine、Windows 工具或二进制依赖
- ✅ **跨平台兼容**（Linux/macOS/Windows 编译环境均可用）
- ✅ **resedit** 是专门为 Node.js PE 文件编辑设计的成熟库
- ✅ 支持标准 Windows .ico 格式（多尺寸图标）
- ✅ 在 Docker 容器内直接执行，无需后处理

这样生成的 EXE 文件本身就包含了自定义图标，无需依赖外部图标文件。

## 使用示例

```bash
# 1. 准备图标文件
cp your-custom-icon.ico compile/app-icon.ico

# 2. 重新编译
cd compile
./compile_exe_bytenode.sh
```

编译完成后，生成的 `.exe` 和安装程序都会使用你的自定义图标。

## 默认图标

如果没有提供 `app-icon.ico`，系统会使用 NSIS 的默认图标。

## 技术细节

### NSIS 配置（自动生成）
```nsis
!define MUI_ICON "app-icon.ico"           ; 安装程序图标
!define MUI_UNICON "app-icon.ico"         ; 卸载程序图标
```

### 快捷方式图标
```nsis
CreateShortcut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${APP_NAME}.exe" "" "$INSTDIR\app-icon.ico"
```

## 故障排除

**Q: 图标没有显示？**
- 检查 `compile/app-icon.ico` 是否存在
- 确保图标文件格式正确（必须是 .ico）
- 重新编译并清除 Windows 图标缓存：
  ```cmd
  ie4uinit.exe -show
  ```

**Q: 如何使用高质量图标？**
- 使用矢量图形软件（如 Inkscape、Adobe Illustrator）导出多尺寸 PNG
- 使用 ImageMagick 批量生成：
  ```bash
  convert icon.png -resize 256x256 icon-256.png
  convert icon.png -resize 128x128 icon-128.png
  # ... 其他尺寸
  # 合并为 .ico
  convert icon-*.png icon.ico
  ```
