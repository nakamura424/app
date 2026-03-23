// グラフ描画処理
axios.get('/api/sales')
  .then(res => {
    const labels = res.data.map(d => d.date);
    const values = res.data.map(d => d.amount);

    new Chart(document.getElementById('myChart'), {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: '売上',
          data: values,
          borderColor: 'blue',
          borderWidth: 2,
          fill: false
        }]
      }
    });
  })
  .catch(err => {
    console.error('データ取得失敗:', err);
  });
