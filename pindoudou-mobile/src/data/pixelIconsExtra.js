/* 交付包没有覆盖、但界面确实用到的像素图标。
   规格与 04_像素图标/SVG 一致：12×12、深色描边 + 品牌色。
   rows 里的字母是 palette 的下标（a=0, b=1, c=2），"." 表示透明。 */

export const PIXEL_EXTRA_ICONS = {
  alert: {
    palette: ['#241D19', '#FF8C45'],
    rows: [
      '....aaaa....',
      '...a....a...',
      '...a.bb.a...',
      '..a..bb..a..',
      '..a.bbbb.a..',
      '.a..bbbb..a.',
      '.a.bbbbbb.a.',
      'a..bbbbbb..a',
      'a.bbbbbbbb.a',
      'a.bbbbbbbb.a',
      'aaaaaaaaaaaa',
      '............'
    ]
  },
  info: {
    palette: ['#241D19', '#38A9F3', '#FFFFFF'],
    rows: [
      '...aaaaaa...',
      '..abbbbbba..',
      '.abbbbbbbba.',
      'abbbbbbbbbba',
      'abbbbccbbbba',
      'abbbbccbbbba',
      'abbbbbbbbbba',
      'abbbbccbbbba',
      'abbbbccbbbba',
      '.abbbbbbbba.',
      '..abbbbbba..',
      '...aaaaaa...'
    ]
  },
  user: {
    palette: ['#241D19', '#38A9F3'],
    rows: [
      '....aaaa....',
      '...abbbba...',
      '...abbbba...',
      '....aaaa....',
      '...aaaaaa...',
      '..abbbbbba..',
      '.abbbbbbbba.',
      '.abbbbbbbba.',
      '.abbbbbbbba.',
      '.abbbbbbbba.',
      '..aaaaaaa...',
      '............'
    ]
  },
  chart: {
    palette: ['#241D19', '#28BF87'],
    rows: [
      '............',
      '............',
      '.......aa...',
      '.......bb...',
      '.....aa.bb..',
      '.....bb.bb..',
      '.aa..bb.bb..',
      '.bb..bb.bb..',
      '.bb..bb.bb..',
      '.bb..bb.bb..',
      '.aaaaaaaaa..',
      '............'
    ]
  },
  box: {
    palette: ['#241D19', '#FFDA35'],
    rows: [
      '............',
      '...aaaaaa...',
      '..abbbbbba..',
      '.abbbbbbbba.',
      'aaaaaaaaaaaa',
      'abbbbbbbbbba',
      'abbbbbbbbbba',
      'abbbbbbbbbba',
      'abbbbbbbbbba',
      '.abbbbbbbba.',
      '..abbbbbba..',
      '...aaaaaa...'
    ]
  },
  layers: {
    palette: ['#241D19', '#38A9F3'],
    rows: [
      '............',
      '...aaaaaa...',
      '..abbbbbba..',
      '.aaaaaaaaaa.',
      '..abbbbbba..',
      '.aaaaaaaaaa.',
      '..abbbbbba..',
      '.aaaaaaaaaa.',
      '..abbbbbba..',
      '...aaaaaa...',
      '............',
      '............'
    ]
  },
  list: {
    palette: ['#241D19', '#FFDA35'],
    rows: [
      '............',
      '.bb..aaaaaa.',
      '.bb..aaaaaa.',
      '............',
      '.bb..aaaaaa.',
      '.bb..aaaaaa.',
      '............',
      '.bb..aaaaaa.',
      '.bb..aaaaaa.',
      '............',
      '............',
      '............'
    ]
  },
  sparkles: {
    palette: ['#F45E93'],
    rows: [
      '............',
      '....a.......',
      '...aaa......',
      '..aaaaa.....',
      '...aaa...a..',
      '....a...aaa.',
      '.......aaaaa',
      '........a...',
      '............',
      '....a.......',
      '...aaa......',
      '....a.......'
    ]
  },
  photo: {
    palette: ['#241D19', '#38A9F3', '#FFDA35'],
    rows: [
      'aaaaaaaaaaaa',
      'abbbbbbbbbba',
      'abbbbbbbbbba',
      'abbbbccbbbba',
      'abbbccccbbba',
      'abbbccccbbba',
      'abbbbbbbbbba',
      'abbbbbbbbbba',
      'abbbbbbbbbba',
      'abbbbbbbbbba',
      'aaaaaaaaaaaa',
      '............'
    ]
  },
  play: {
    palette: ['#F45E93'],
    rows: [
      '............',
      '...a........',
      '...aaa......',
      '...aaaaa....',
      '...aaaaaaa..',
      '...aaaaaaaaa',
      '...aaaaaaa..',
      '...aaaaa....',
      '...aaa......',
      '...a........',
      '............',
      '............'
    ]
  },
  cat: {
    palette: ['#241D19', '#F4A15B', '#241D19', '#F45E93'],
    rows: [
      '............',
      '..aa....aa..',
      '..aba..aba..',
      '..abbaabba..',
      '.abbbbbbbba.',
      'abbbbbbbbbba',
      'abbbbbbbbbba',
      'abbcbbbbcbba',
      'abbbbbbbbbba',
      '.abbbddbbba.',
      '..abbbbbba..',
      '...aaaaaa...'
    ]
  },
  cake: {
    palette: ['#241D19', '#FFD35C', '#F45E93'],
    rows: [
      '.....aa.....',
      '....abba....',
      '...abbbba...',
      '..abbbbbba..',
      '..abbbbbba..',
      '.acccccccca.',
      '.abbbbbbbba.',
      '.abbbbbbbba.',
      '.abbbbbbbba.',
      '.aaaaaaaaaa.',
      '............',
      '............'
    ]
  },
  flower: {
    palette: ['#241D19', '#F45E93', '#FFDA35', '#28BF87'],
    rows: [
      '....bbbb....',
      '...bbbbbb...',
      '..bbbbbbbb..',
      '..bbbbbbbb..',
      '...bbbbbb...',
      '....bccb....',
      '.....dd.....',
      '.....dd.....',
      '.....dd.....',
      '....dddd....',
      '.....dd.....',
      '............'
    ]
  },
  gift: {
    palette: ['#241D19', '#FFDA35', '#F45E93'],
    rows: [
      '...aa..aa...',
      '..abbaabba..',
      '..abbaabba..',
      '..aaaaaaaa..',
      '..abbbbbba..',
      '..abbccbba..',
      '..abbbbbba..',
      '..abbbbbba..',
      '..abbbbbba..',
      '..aaaaaaaa..',
      '............',
      '............'
    ]
  }
}
