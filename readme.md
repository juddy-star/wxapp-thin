# wxapp-gulp 微信小程序瘦身 （减小主包体积）

## features

- 可指定文件夹进行优化（例如src或者dist）
- 目前支持import require引入模式的优化，后续支持component组件的引入模式
- 完全异步执行，总耗时不超过1500ms
- 提供table展示，方便进行优化统计

## 命令

```js
npm start
```

## 目录

```js
miniPackage
├── index.js
└── utils.js
```