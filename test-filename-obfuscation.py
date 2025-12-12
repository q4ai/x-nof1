#!/usr/bin/env python3
"""
文件名混淆测试脚本
在本地 dist 目录测试文件名混淆功能
"""

import os
import re
import hashlib
import random
import shutil

def obfuscate_filenames(dist_dir="dist", dry_run=True):
    """
    混淆 dist 目录中的文件名
    
    Args:
        dist_dir: 目标目录
        dry_run: True 时仅打印操作，不实际修改文件
    """
    file_mapping = {}  # 旧文件名 -> 新文件名
    
    print(f"{'[DRY RUN] ' if dry_run else ''}开始扫描 {dist_dir} 目录...")
    
    # 1. 生成文件名映射表（排除 index.js）
    for filename in os.listdir(dist_dir):
        if filename.endswith(".js") and filename != "index.js":
            # 生成随机哈希文件名
            random_hash = hashlib.md5(f"{filename}{random.random()}".encode()).hexdigest()[:12]
            new_filename = f"_{random_hash}.js"
            file_mapping[filename] = new_filename
            print(f"  映射: {filename} -> {new_filename}")
    
    print(f"\n找到 {len(file_mapping)} 个需要混淆的文件")
    
    if not file_mapping:
        print("没有需要处理的文件")
        return
    
    # 2. 更新所有 JS 文件中的 import/require 语句
    print("\n更新文件引用...")
    for root, dirs, files in os.walk(dist_dir):
        for file in files:
            if file.endswith(".js"):
                filepath = os.path.join(root, file)
                
                with open(filepath, "r", encoding="utf-8") as f:
                    content = f.read()
                
                original_content = content
                
                # 替换文件内容中的引用
                for old_name, new_name in file_mapping.items():
                    # 匹配各种 import/require 模式
                    patterns = [
                        # import "./file.js"
                        (rf'import\s+"\./{re.escape(old_name)}"', f'import "./{new_name}"'),
                        # import * as name from "./file.js"
                        (rf'from\s+"\./{re.escape(old_name)}"', f'from "./{new_name}"'),
                        # require("./file.js")
                        (rf'require\("\./{re.escape(old_name)}"\)', f'require("./{new_name}")'),
                        # import { } from "./file.js"
                        (rf'import\s+\{{[^}}]+\}}\s+from\s+"\./{re.escape(old_name)}"', 
                         lambda m: m.group(0).replace(f'./{old_name}', f'./{new_name}')),
                    ]
                    
                    for pattern, replacement in patterns:
                        if re.search(pattern, content):
                            content = re.sub(pattern, replacement, content)
                
                if content != original_content:
                    print(f"  更新引用: {file}")
                    if not dry_run:
                        with open(filepath, "w", encoding="utf-8") as f:
                            f.write(content)
    
    # 3. 重命名文件
    print("\n重命名文件...")
    for old_name, new_name in file_mapping.items():
        old_path = os.path.join(dist_dir, old_name)
        new_path = os.path.join(dist_dir, new_name)
        
        if os.path.exists(old_path):
            print(f"  {old_name} -> {new_name}")
            if not dry_run:
                os.rename(old_path, new_path)
    
    print(f"\n{'[DRY RUN] ' if dry_run else ''}文件名混淆完成！")

if __name__ == "__main__":
    import sys
    
    # 检查是否传入 --execute 参数
    dry_run = "--execute" not in sys.argv
    
    if dry_run:
        print("=" * 60)
        print("文件名混淆测试模式（不会实际修改文件）")
        print("如需实际执行，请运行: python3 test-filename-obfuscation.py --execute")
        print("=" * 60)
        print()
    else:
        print("=" * 60)
        print("⚠️  警告：即将修改 dist 目录中的文件！")
        print("=" * 60)
        response = input("确认继续？(yes/no): ")
        if response.lower() != "yes":
            print("已取消")
            sys.exit(0)
        print()
    
    obfuscate_filenames(dry_run=dry_run)
    
    if dry_run:
        print("\n提示：这只是预览。实际打包时会在 Docker 中自动执行混淆。")
