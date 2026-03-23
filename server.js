const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const e = require('express');
const prisma = new PrismaClient();

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({ secret: 'secret-key', resave: false, saveUninitialized: true }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

const user = { username: 'kaito', password: 'mario424' };

app.get('/', (req, res) => res.redirect('/login'));
app.get('/login', (req, res) => res.render('login'));
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === user.username && password === user.password) {
    req.session.user = username;
    res.redirect('/menu');
  } else res.render('login', { error: 'ログイン失敗' });
});

app.get('/menu', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  res.render('menu', { user: req.session.user });
});

app.get('/chart', async (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  const subjects = await prisma.M_SUBJECT.findMany({
    where: { DC_cd: 'C' },
    orderBy: [{ major_cd: 'asc' }, { middle_cd: 'asc' }, { minor_cd: 'asc' }],
  });
  res.render('chart', { subjects, user: req.session.user });
});

// API: 店舗別単価
app.get('/api/unit_prices', async (req, res) => {
  const { subject, startDate, endDate } = req.query;
  if (!subject) return res.json([]);
  const [major_cd, middle_cd, minor_cd] =
    subject.split(',').map(v => v ? parseInt(v) : null);
  console.table({ major_cd, middle_cd, minor_cd, startDate, endDate });
  const whereCondition = {
    major_cd,
    middle_cd,
    minor_cd,
    base_date: {
      gte: startDate ? parseInt(startDate) : undefined,
      lte: endDate ? parseInt(endDate) : undefined
    }
  };

  const data = await prisma.T_UNIT_PRICE.findMany({
    where: whereCondition,
    orderBy: { base_date: 'asc' },
    include: { store: true }
  });

  res.json(data);
});

// GET /shopping_register
app.get('/shopping_register', async (req, res) => {
  try {
    if (!req.session.user) return res.redirect('/login');

    const stores = await prisma.M_STORE.findMany();

    // 支払方法（DC_cd='D'）
    const payment_subjects = await prisma.M_SUBJECT.findMany({
      where: { DC_cd: 'D' },
      orderBy: [{ major_cd: 'asc' }, { middle_cd: 'asc' }, { minor_cd: 'asc' }],
    });

    // 全科目取得（DC_cd='C'）
    const allSubjects = await prisma.M_SUBJECT.findMany({
      where: { DC_cd: 'C' },
      orderBy: [{ major_cd: 'asc' }, { middle_cd: 'asc' }, { minor_cd: 'asc' }],
    });

    // minor_cd があるものだけ商品として表示
    const subjects = allSubjects
      .filter(s => s.minor_cd !== null)
      .map(s => {
        const major = allSubjects.find(m => m.major_cd === s.major_cd && m.middle_cd === null);
        const middle = allSubjects.find(m => m.major_cd === s.major_cd && m.middle_cd === s.middle_cd && m.minor_cd === null);
        return {
          ...s,
          label: `${major ? major.subject_name : ''} > ${middle ? middle.subject_name : ''} > ${s.subject_name}`
        };
      });

    // 中項目一覧だけ作る（手入力用）
    const middleSubjects = allSubjects
      .filter(s => s.middle_cd !== null && s.minor_cd === null)
      .map(s => {
        const major = allSubjects.find(m => m.major_cd === s.major_cd && m.middle_cd === null);
        return {
          ...s,
          label: `${major ? major.subject_name : ''} > ${s.subject_name}`
        };
      });

    const today = new Date().toISOString().split('T')[0];

    res.render('shopping_register', { stores, payment_subjects, subjects, middleSubjects, today });
  } catch (err) {
    console.error(err);
    res.status(500).send('サーバーエラー');
  }
});

// API: 買い物登録受け取り
app.post('/api/accounting', async (req, res) => {
  try {
    const { base_date, store_id, payment_subject_id, items } = req.body;

    let accounting_data = {base_date:base_date, store_id:store_id, payment_subject_id:payment_subject_id};

    let accountingEntries = [];
    const max_minor_array = await prisma.M_SUBJECT.groupBy({
      by: ['major_cd', 'middle_cd'],
      _max: {
        minor_cd: true
      },
      orderBy: [
        { major_cd: 'asc' },
        { middle_cd: 'asc' }
      ]
    });

    for (const [index, item] of items.entries()) {
      if (!item || (!item.subject && !item.middle_cd)) continue; // 空行スキップ
      if (item.isUnknown === 0) {
        accountingEntries[index] = {
          major_cd: parseInt(item.subject.split(',')[0]),
          middle_cd: parseInt(item.subject.split(',')[1]),
          minor_cd: parseInt(item.subject.split(',')[2]),
          subject_name: null,
          quantity: item.quantity,
          amount: item.amount,
          new_record: false
        };
      } else if (item.isUnknown === 1) {
        accountingEntries[index] = {
          major_cd: parseInt(item.middle_cd.split(',')[0]),
          middle_cd: parseInt(item.middle_cd.split(',')[1]),
          minor_cd: max_minor_array.find(m =>
                        m.major_cd === parseInt(item.middle_cd.split(',')[0]) &&
                        m.middle_cd === parseInt(item.middle_cd.split(',')[1])
                      )._max.minor_cd + 1,
          subject_name: item.custom_subject,
          quantity: item.quantity,
          amount: item.amount,
          new_record: true
        };

        max_minor_array.find(m =>
          m.major_cd === parseInt(item.middle_cd.split(',')[0]) &&
          m.middle_cd === parseInt(item.middle_cd.split(',')[1])
        )._max.minor_cd += 1; // 次の新規登録用にインクリメント
      }
    }
    // セッションに保存
    req.session.accountingEntries = accountingEntries;
    req.session.accounting_data = accounting_data;

    res.json({ message: '受け取り成功', count: items.length });
  } catch (err) {
    console.error('POST /api/accounting エラー:', err);
    res.status(500).json({ error: 'サーバーエラー' });
  }
});

// GET /subject_register
app.get('/subject_register', async (req, res) => {
  try {
    if (!req.session.user) return res.redirect('/login');

    // セッションに保存されている accountingEntriesを取得
    const accountingEntries = req.session.accountingEntries || [];
    // 科目取得（DC_cd='C'）
    const allSubjects = await prisma.M_SUBJECT.findMany({
      where: { DC_cd: 'C' , minor_cd: null },
      orderBy: [{ major_cd: 'asc' }, { middle_cd: 'asc' }],
    });

    // 中項目一覧を作る（手入力用）
    const middleSubjectsMap = allSubjects
      .reduce((acc, s) => {
        const major = allSubjects.find(m => m.major_cd === s.major_cd && m.middle_cd === null);
        if (!acc[s.major_cd]) acc[s.major_cd] = {};       // major_cd のオブジェクトを作る
        acc[s.major_cd][s.middle_cd] = s.subject_name;
        return acc;
      }, {});   

    // 大項目一覧を作る（手入力用）
    const majorSubjectsMap = allSubjects
      .filter(s => s.middle_cd === null)
      .reduce((acc, s) => {
        acc[s.major_cd] = s.subject_name
        return acc;
      }, {});


    // isUnknown === 1 のレコードのみ抽出し new_record: true を付与
    const unknownEntries = accountingEntries
      .filter(entry => entry.new_record)
      .map(entry => ({
        major_cd: entry.major_cd,
        middle_cd: entry.middle_cd,
        minor_cd: entry.minor_cd,
        major_label: majorSubjectsMap[entry.major_cd],
        middle_label: middleSubjectsMap[entry.major_cd][entry.middle_cd],
        subject_name: entry.subject_name,
        unit: entry.quantity >= 100 ? "g" : "個",
        quantity_of_per_unit: entry.quantity >= 100 ? 100 : 1
        })
      );

    // subject_register.ejs に渡す
    res.render('subject_register', {unknownEntries});
  } catch (err) {
    console.error(err);
    res.status(500).send('サーバーエラー');
  }
});


// API: 項目登録受け取り
app.post('/api/subject', async (req, res) => {
  try {
    const subject_data = req.body;

    // セッションに保存
    req.session.subject_data = subject_data;

    res.json({ message: '受け取り成功', count: subject_data.length });
  } catch (err) {
    console.error('POST /api/subject エラー:', err);
    res.status(500).json({ error: 'サーバーエラー' });
  }
});

// GET /subject_register
app.get('/unit_register', async (req, res) => {
  try {
    // セッションに保存されている accounting_data を取得
    const accounting_data = req.session.accounting_data || [];
    // 店舗取得
    const store = await prisma.M_STORE.findUnique({
      where: { store_id: accounting_data.store_id }
    });

    // 支払方法（DC_cd='D'）
    const payment_subjects = await prisma.M_SUBJECT.findUnique({
      where: { DC_cd: 'D', subject_id: accounting_data.payment_subject_id }
    });

    let base_data = {
      base_date: accounting_data.base_date,
      store_name: store ? store.store_name + " " + store.branch_name : '',
      subject_name: payment_subjects.subject_name || ''
    };

    // 単価データをセッションから取得
    let unitPriseEntries = [];
    let accountingEntries = req.session.accountingEntries || [];
    let new_subjects = req.session.subject_data || [];
    // 科目取得（DC_cd='C'）
    const allSubjects = await prisma.M_SUBJECT.findMany({
      where: { DC_cd: 'C' },
      orderBy: [{ major_cd: 'asc' }, { middle_cd: 'asc' }],
    });


    for (const entry of accountingEntries) {
      const major_subject = allSubjects.find(s => s.major_cd === entry.major_cd && s.middle_cd === null).subject_name;
      const middle_subject = allSubjects.find(s => 
                                s.major_cd === entry.major_cd && 
                                s.middle_cd === entry.middle_cd && 
                                s.minor_cd === null
                              ).subject_name;
      let minor_subject = null;
      let unit_price = null;
      
      if (entry.new_record) {
        // 新規科目の場合、subject_data から単価データを作成
        const subject_info = new_subjects.find(s =>
          Number(s.major_cd) === entry.major_cd &&
          Number(s.middle_cd) === entry.middle_cd &&
          s.subject_name === entry.subject_name
        );
        if (subject_info) {
          minor_subject = subject_info.subject_name;
          unit_price = entry.amount / entry.quantity * subject_info.quantity_of_per_unit;
        }
      } else {
        // 既存科目の場合、M_SUBJECT から単価データを作成
        const subject = allSubjects.find(s =>
          s.major_cd === entry.major_cd &&
          s.middle_cd === entry.middle_cd &&
          s.minor_cd === entry.minor_cd
        );
        if (subject) {
          minor_subject = subject.subject_name;
          unit_price = entry.amount / entry.quantity * subject.quantity_of_per_unit;
        }
      }
      unitPriseEntries.push({
        major_cd: entry.major_cd,
        major_subject: major_subject,
        middle_cd: entry.middle_cd,
        middle_subject: middle_subject,
        minor_cd: entry.minor_cd,
        minor_subject: minor_subject,
        unit_price: unit_price
      });
    }


    // unit_register.ejs に渡す
    res.render('unit_register', { base_data, unitPriseEntries });
  } catch (err) {
    console.error(err);
    res.status(500).send('サーバーエラー');
  }
});

// API: 単価登録受け取り
app.post('/api/unit', async (req, res) => {
  try {
    const unit_list = req.body;

    // セッションに保存
    req.session.unit_list = unit_list;

    res.json({ message: '受け取り成功', count: unit_list.length });
  } catch (err) {
    console.error('POST /api/subject エラー:', err);
    res.status(500).json({ error: 'サーバーエラー' });
  }
});


// GET /register_check
app.get('/register_check', async (req, res) => {
  try {

    // セッションに保存されているデータを取得
    let accounting_data = req.session.accounting_data || [];
    let accountingEntries = req.session.accountingEntries || [];
    let subject_data = req.session.subject_data || [];
    let unit_list = req.session.unit_list || [];

    // 全科目取得（DC_cd='C'）
    const allSubjects = await prisma.M_SUBJECT.findMany({
      where: { DC_cd: 'C' },
      orderBy: [{ major_cd: 'asc' }, { middle_cd: 'asc' }, { minor_cd: 'asc' }],
    });

    accounting_data.store_name = (await prisma.M_STORE.findUnique({
      where: { store_id: accounting_data.store_id }
    }))?.store_name || '';


    accounting_data.payment_subject_name = (await prisma.M_SUBJECT.findUnique({
      where: { subject_id: accounting_data.payment_subject_id }
    }))?.subject_name || '';

    // 科目名変換
    accountingEntries = accountingEntries.map(entry => {
      let major_subject = allSubjects.find(s => s.major_cd === entry.major_cd && s.middle_cd === null).subject_name;
      let middle_subject = allSubjects.find(s => 
                                s.major_cd === entry.major_cd && 
                                s.middle_cd === entry.middle_cd && 
                                s.minor_cd === null
                              ).subject_name;
      let minor_subject = '';
      if (entry.new_record) {
        minor_subject = entry.subject_name;
      } else {
        minor_subject = allSubjects.find(s =>
          s.major_cd === entry.major_cd &&
          s.middle_cd === entry.middle_cd &&
          s.minor_cd === entry.minor_cd
        ).subject_name;
      }
      return {
        major_subject: major_subject,
        middle_subject: middle_subject,
        minor_subject: minor_subject,
        quantity: entry.quantity,
        amount: entry.amount
      };
    });


    subject_data = subject_data.map(entry => {
      let major_subject = allSubjects.find(s => s.major_cd === Number(entry.major_cd) && s.middle_cd === null).subject_name;
      let middle_subject = allSubjects.find(s =>
                            s.major_cd === Number(entry.major_cd) &&
                            s.middle_cd === Number(entry.middle_cd) &&
                            s.minor_cd === null
                          ).subject_name;                 
      return {
        major_subject: major_subject,
        middle_subject: middle_subject,
        minor_subject: entry.subject_name,
        unit: entry.unit,
        quantity_of_per_unit: entry.quantity_of_per_unit
      };
    });

    unit_list = unit_list.map(entry => {
      let major_subject = allSubjects.find(s => s.major_cd === Number(entry.major_cd) && s.middle_cd === null).subject_name;
      let middle_subject = allSubjects.find(s =>
                            s.major_cd === Number(entry.major_cd) &&
                            s.middle_cd === Number(entry.middle_cd) &&
                            s.minor_cd === null
                          ).subject_name;    
      
      return {
        major_subject: major_subject,
        middle_subject: middle_subject,
        minor_subject: entry.minor_subject,
        unit_price: entry.unit_price
      };
    });

    // register_check.ejs に渡す
    res.render('register_check', { accounting_data, accountingEntries, subject_data, unit_list });
    
  } catch (err) {
    console.error(err);
    res.status(500).send('サーバーエラー');
  }
});

// API: 単価登録受け取り
app.post('/api/register_execute', async (req, res) => {
  try {
    console.log('=== セッションデータ確認 ===');
    console.log('=== accounting_data ===');
    console.table(req.session.accounting_data);

    
    console.log('=== セッションデータ登録 ===');
    console.log('=== subject_data ===');
    console.table(req.session.subject_data);
    console.log('=== unit_list ===');
    console.table(req.session.unit_list);
    console.log('=== accountingEntries ===');
    console.table(req.session.accountingEntries);

    const result = await prisma.T_ACCOUNTING.aggregate({
      _max: {
        seq: true
      }
    });

    const maxAccountingSeq = result._max.seq ?? 0;


    const payment_subject = await prisma.M_SUBJECT.findUnique({
      where: { subject_id: req.session.accounting_data.payment_subject_id }
    });

    base_date = Number(req.session.accounting_data.base_date.replace(/-/g, ''));
    await prisma.$transaction(async (tx) => {
      await tx.M_SUBJECT.createMany({
        data: req.session.subject_data.map(entry => ({
          major_cd: Number(entry.major_cd),
          middle_cd: Number(entry.middle_cd),
          minor_cd: Number(entry.minor_cd),
          DC_cd: 'C',
          subject_name: entry.subject_name,
          is_graph_enabled: 1,
          unit: entry.unit,
          quantity_of_per_unit: entry.quantity_of_per_unit,
          created_user: req.session.user,
        }))
      });

      await tx.T_UNIT_PRICE.createMany({
        data: req.session.unit_list.map(entry => ({
          major_cd: Number(entry.major_cd),
          middle_cd: Number(entry.middle_cd),
          minor_cd: Number(entry.minor_cd),
          store_id: req.session.accounting_data.store_id,
          base_date: base_date,
          unit_price: entry.unit_price,
          created_user: req.session.user,
        }))
      });



      await tx.T_ACCOUNTING.createMany({
        data: req.session.accountingEntries.map(entry => ({
          major_cd: Number(entry.major_cd),
          middle_cd: Number(entry.middle_cd),
          minor_cd: Number(entry.minor_cd),
          seq: maxAccountingSeq + 1,
          store_id: req.session.accounting_data.store_id,
          base_date: base_date,
          DC_cd: 'C',
          quantity: entry.quantity,
          amount: entry.amount,
          created_user: req.session.user,
        }))
      });

      await tx.T_ACCOUNTING.create({
        data: {
          major_cd: payment_subject.major_cd,
          middle_cd: payment_subject.middle_cd,
          minor_cd: payment_subject.minor_cd,
          seq: maxAccountingSeq + 1,
          store_id: req.session.accounting_data.store_id,
          base_date: base_date,
          DC_cd: 'D',
          quantity: 1,
          amount: req.session.accountingEntries.reduce((sum, entry) => sum + entry.amount, 0),
          created_user: req.session.user,
        }
      });

    });

    res.json({ message: '受け取り成功'});
  } catch (err) {
    console.error('POST /api/subject エラー:', err);
    res.status(500).json({ error: 'サーバーエラー' });
  }
});

function getMonthRange(yyyymm) {
  const year = Math.floor(yyyymm / 100);
  const month = yyyymm % 100; // 1〜12

  const start = year * 10000 + month * 100 + 1;

  const lastDay = new Date(year, month, 0).getDate();

  const end = year * 10000 + month * 100 + lastDay;

  return { start, end };
}


app.get('/check_cost', async (req, res) => {
  try {
    // 対象月
    let targetMonth;
    if (!req.query.target_month) {
      const now = new Date();
      targetMonth = now.getFullYear() * 100 + (now.getMonth() + 1);
    } else {
      targetMonth = parseInt(req.query.target_month);
    }

    const { start: startDate, end: endDate } = getMonthRange(targetMonth);

    // 支払方法選択
    const selectedMajorCd = req.query.major_cd ? parseInt(req.query.major_cd, 10) : null;

    // where 条件作成
    const whereCondition = {
      base_date: { gte: startDate, lte: endDate },
      DC_cd: 'D'
    };
    if (selectedMajorCd) whereCondition.major_cd = selectedMajorCd;

    // ① 支払方法からSeq取得
    const seqList = await prisma.T_ACCOUNTING.findMany({
      where: whereCondition,
      select: { seq: true },
      distinct: ['seq']
    });

    const seqValues = seqList.map(s => s.seq);
    if (!seqValues.length) {
      return res.render('check_cost', {
        targetMonth,
        resultList: [],
        paymentMethods: [],
        selectedMajorCd
      });
    }

    // ② major_cd, middle_cd ごと合計
    const summaryByMajor = await prisma.T_ACCOUNTING.groupBy({
      by: ['major_cd', 'middle_cd'],
      where: { base_date: { gte: startDate, lte: endDate }, DC_cd: 'C', seq: { in: seqValues } },
      _sum: { amount: true },
      orderBy: [{ major_cd: 'asc' }, { middle_cd: 'asc' }]
    });

    // 科目名取得
    const subjects = await prisma.M_SUBJECT.findMany({
      where: {
        minor_cd: null,
        OR: summaryByMajor.map(s => ({ major_cd: s.major_cd, middle_cd: s.middle_cd }))
      },
      select: { major_cd: true, middle_cd: true, subject_name: true }
    });

    const subjectMap = new Map(
      subjects.map(s => [`${s.major_cd}-${s.middle_cd}`, s.subject_name])
    );

    // major_subject_name を取得
    const majorSubjects = await prisma.M_SUBJECT.findMany({
      where: { DC_cd: 'C', middle_cd: null },
      orderBy: [{ major_cd: 'asc' }]
    });

    const resultList = summaryByMajor.map(row => {
      const majorSubject = majorSubjects.find(s => s.major_cd === row.major_cd);
      return {
        major_cd: row.major_cd,
        middle_cd: row.middle_cd,
        major_subject_name: majorSubject?.subject_name ?? '未設定',
        subject_name: subjectMap.get(`${row.major_cd}-${row.middle_cd}`) ?? '未設定',
        total_amount: row._sum.amount ?? 0
      };
    });

    // 支払方法一覧取得
    const paymentMethods = await prisma.M_SUBJECT.findMany({
      where: { DC_cd: 'D' },
      select: { major_cd: true, subject_name: true },
      distinct: ['major_cd']
    });

    res.render('check_cost', {
      targetMonth,
      resultList,
      paymentMethods,
      selectedMajorCd
    });

  } catch (err) {
    console.error(err);
    res.status(500).send('支出確認取得エラー');
  }
});



app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`server start : ${port}`);
});
