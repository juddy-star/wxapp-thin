# wxapp-thin 微信小程序瘦身 （减小主包体积）

## features

- 可指定文件夹进行优化（推荐优化dist，不改变开发者的习惯）
- 可指定分包进行优化（optSubPackage）
- 可指定文件夹进行下发（黑白名单）
- 支持所有文件格式的引入（自定义组件和一般文件）
- 可指定分包和总包的大小
- 可指定依赖文件最大引入次数限制
- 完全异步执行，总耗时不超过8000ms
- 提供table展示，方便进行优化和错误统计
- 错误统计支持：循环引用提示，依赖错误提示，总包和分包超限提示

## 命令

```js
npm start
```

## 目录

```js
miniPackage
├── config.js
├── error.js
├── index.js
├── log.js
└── utils.js

dist                 -----打包后的目录
├── app.json         -----小程序json文件
├── components       -----小程序compoents文件夹（例如存放公共template）
└── pages            -----小程序页面
    └── examples     -----其中一个页面
        └── build    -----从公共components中下发到examples页面下的目录
```