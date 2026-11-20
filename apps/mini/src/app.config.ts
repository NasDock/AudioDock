export default defineAppConfig({
  pages: [
    'pages/index/index',
    'pages/library/index',
    'pages/personal/index',
    'pages/login/index',
    'pages/login-form/index',
    'pages/scan/index',
    'pages/scan-confirm/index',
    'pages/search/index',
    'pages/player/index',
    'pages/artist/index',
    'pages/album/index',
    'pages/collection/index',
    'pages/mv/index',
    'pages/playlist/index',
    'pages/folder/index',
    'pages/settings/index',
    'pages/settings/language/index',
    'pages/settings/playback-quality/index',
    'pages/admin/index',
    'pages/source-manage/index',
    'pages/webdav-sources/index',
    'pages/access-tokens/index',
    'pages/llm-config/index',
    'pages/tts-config/index',
    'pages/mi-speaker/index',
    'pages/plugin-center/index',
    'pages/task-center/index',
    'pages/tts/tasks/index',
    'pages/tts/create/index',
    'pages/member/login/index',
    'pages/member/detail/index',
    'pages/member/benefits/index',
    'pages/member/success/index'
  ],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#fff',
    navigationBarTitleText: 'SoundX',
    navigationBarTextStyle: 'black'
  },
  lazyCodeLoading: "requiredComponents",
  permission: {
    'scope.record': {
      desc: '用于语音搜索'
    }
  },
  tabBar: {
    color: '#999999',
    selectedColor: '#000000',
    backgroundColor: '#ffffff',
    list: [
      {
        pagePath: 'pages/index/index',
        iconPath: 'assets/images/home.png',
        selectedIconPath: 'assets/images/home-fill.png',
        text: '推荐'
      },
      {
        pagePath: 'pages/library/index',
        iconPath: 'assets/images/music.png',
        selectedIconPath: 'assets/images/music-fill.png',
        text: '声仓'
      },
      {
        pagePath: 'pages/personal/index',
        iconPath: 'assets/images/people.png',
        selectedIconPath: 'assets/images/people-fill.png',
        text: '我的'
      }
    ]
  }
})
