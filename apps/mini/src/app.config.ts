export default defineAppConfig({
  pages: [
    'pages/index/index',
    'pages/library/index',
    'pages/personal/index',
    'pages/login/index',
    'pages/search/index',
    'pages/player/index',
    'pages/artist/index',
    'pages/album/index',
    'pages/album/index',
    'pages/settings/index',
    'pages/admin/index',
    'pages/source-manage/index'
  ],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#fff',
    navigationBarTitleText: 'SoundX',
    navigationBarTextStyle: 'black'
  },
  tabBar: {
    color: '#999999',
    selectedColor: '#007aff',
    backgroundColor: '#ffffff',
    list: [
      {
        pagePath: 'pages/index/index',
        text: '推荐'
      },
      {
        pagePath: 'pages/library/index',
        text: '声仓'
      },
      {
        pagePath: 'pages/personal/index',
        text: '我的'
      }
    ]
  }
})
