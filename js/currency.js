// js/currency.js

// Хранение “сегодняшних” курсов
let ratesData = {};
// Кэш для истории, чтобы не запрашивать по одному URL дважды
let historyCache = {};
// Экземпляр Chart.js (если нужно переотрисовать, будем уничтожать предыдущий)
let historyChart = null;

// Ждём, когда DOM будет полностью загружен
window.addEventListener('DOMContentLoaded', () => {
  // 1) Получаем все необходимые элементы
  const selectEl   = document.getElementById('currency');
  const amountEl   = document.getElementById('amount');
  const resultP    = document.getElementById('result');
  const btnConvert = document.getElementById('convert-btn');
  const ctx        = document.getElementById('chart').getContext('2d');

  // Функция форматирования даты в "dd/mm/yyyy"
  function formatDateDDMMYYYY(date) {
    const day   = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year  = date.getFullYear();
    return `${day}/${month}/${year}`;
  }

  // --- 2) Загрузить текущие курсы (JSON с CBR) ---
  async function loadTodayRates() {
    try {
      const resp = await fetch('https://www.cbr-xml-daily.ru/daily_json.js');
      const data = await resp.json();
      ratesData = data.Valute; // тут "Valute" — объект, в котором ключ = CharCode, value = {Value, Nominal, Name, ID, ...}

      // Заполняем select
      fillCurrencyOptions();
    } catch (err) {
      console.error('Ошибка при загрузке курсов:', err);
      alert('Не удалось загрузить текущие курсы валют. Попробуйте обновить страницу.');
    }
  }

  // --- 3) Заполнить <select id="currency"> валютами ---
  function fillCurrencyOptions() {
    // Очистим, если что-то уже было
    selectEl.innerHTML = '';

    // Вставим «RUB» вручную, чтобы можно было выбрать рубли (без курса)
    const optionRub = document.createElement('option');
    optionRub.value = 'RUB';
    optionRub.textContent = 'RUB (Российский рубль)';
    selectEl.appendChild(optionRub);

    // Перебираем все валюты из ratesData (CharCode), добавляем <option>
    for (const code in ratesData) {
      const info = ratesData[code];
      const opt  = document.createElement('option');
      opt.value   = code; // например, "USD", "EUR", "NZD" и т.д.
      opt.textContent = `${code} — ${info.Name}`; 
      selectEl.appendChild(opt);
    }

    // Сразу установим NZD по умолчанию (если есть в todayRates)
    if (ratesData['NZD']) {
      selectEl.value = 'NZD';
    }
  }

  // --- 4) Конвертер: пересчитать при нажатии кнопки ---
  function convertCurrency() {
    const amount = parseFloat(amountEl.value);
    const code   = selectEl.value;

    if (isNaN(amount) || amount <= 0) {
      resultP.textContent = 'Введите сумму больше нуля';
      return;
    }

    if (code === 'RUB') {
      // Просто рубли → рубли
      resultP.textContent = `${amount.toFixed(2)} RUB`;
      // Вместо графика истории можем очищать или оставлять прежний (up to you)
      drawHistoryChart('RUB');
      return;
    }

    const info = ratesData[code];
    if (!info) {
      resultP.textContent = 'Курс для выбранной валюты не найден';
      return;
    }

    // Курс в рублях за 1 единицу валюты:
    const rateRubPerUnit = info.Value / info.Nominal;

    // 1) Рубли → Валюта:
    const inForeign = (amount / rateRubPerUnit).toFixed(4);
    // 2) Валюта → Рубли:
    const inRub = (amount * rateRubPerUnit).toFixed(2);

    resultP.innerHTML =
      `${amount.toFixed(2)} ₽ = <strong>${inForeign} ${code}</strong><br>` +
      `${amount.toFixed(2)} ${code} = <strong>${inRub} ₽</strong>`;

    // После конвертации автоматически перестроим график истории
    drawHistoryChart(code);
  }

  // --- 5) Слушатель клика по кнопке «Перевести» ---
  btnConvert.addEventListener('click', convertCurrency);

  // --- 6) Построить (или обновить) столбчатый график истории курса за 30 дней ---
  async function drawHistoryChart(currencyCode) {
    // Если выбрали «RUB», просто удаляем предыдущий график (никакой истории для рубля не строим)
    if (currencyCode === 'RUB') {
      if (historyChart) {
        historyChart.destroy();
      }
      return;
    }

    const info = ratesData[currencyCode];
    if (!info || !info.ID) {
      console.error('Не удалось найти ID для динамики', currencyCode);
      return;
    }

    // Сгенерируем список дат за последние 30 дней (включая сегодня) в формате "yyyy-mm-dd"
    const dates = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const yyyy = d.getFullYear();
      const mm   = String(d.getMonth() + 1).padStart(2, '0');
      const dd   = String(d.getDate()).padStart(2, '0');
      dates.push(`${yyyy}-${mm}-${dd}`);
    }

    // Функция для запроса одного дня (и кеширования)
    async function fetchOneDay(dateStr) {
      if (historyCache[dateStr]) {
        return historyCache[dateStr];
      }
      // API: https://www.cbr-xml-daily.ru/archive/YYYY/MM/DD/daily_json.js
      const [yyyy, mm, dd] = dateStr.split('-');
      const url = `https://www.cbr-xml-daily.ru/archive/${yyyy}/${mm}/${dd}/daily_json.js`;
      try {
        const resp = await fetch(url);
        const data = await resp.json();
        historyCache[dateStr] = data;
        return data;
      } catch (e) {
        console.warn(`Ошибка при загрузке курса за ${dateStr}`, e);
        return null;
      }
    }

    // Загружаем параллельно все 30 дней
    const allPromises = dates.map(d => fetchOneDay(d));
    const allResults  = await Promise.all(allPromises);

    // Отфильтруем те дни, когда валюта действительно есть (иногда выходные/праздники)
    const validDates = [];
    const validRates = [];
    for (let i = 0; i < dates.length; i++) {
      const dayData = allResults[i];
      if (dayData && dayData.Valute && dayData.Valute[currencyCode]) {
        validDates.push(dates[i].split('-').reverse().join('.')); // преобразуем в "dd.mm.yyyy"
        const rateInfo = dayData.Valute[currencyCode];
        const ratePerOne = rateInfo.Value / rateInfo.Nominal;
        validRates.push(+ratePerOne.toFixed(4));
      }
    }

    // Если ранее был график, уничтожим его
    if (historyChart) {
      historyChart.destroy();
    }

    // Создаём новый столбчатый график
    historyChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: validDates,
        datasets: [{
          label: `${currencyCode} (RUB)`,
          data: validRates,
          backgroundColor: '#ffbf00',
          hoverBackgroundColor: '#ffd966'
        }]
      },
      options: {
        responsive: true,
        scales: {
          x: {
            ticks: {
              maxRotation: 90,
              minRotation: 45,
              autoSkip: true,
              maxTicksLimit: 10
            },
            grid: { display: false }
          },
          y: {
            ticks: { color: '#e0e0e0' },
            grid: { color: '#2a2a45' }
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => `${ctx.parsed.y.toFixed(4)} ₽`,
            }
          }
        },
        onClick: (evt, elements) => {
          if (elements.length) {
            const idx  = elements[0].index;
            const date = validDates[idx];
            const val  = validRates[idx].toFixed(4);
            alert(`${currencyCode} на ${date} = ${val} ₽`);
          }
        }
      }
    });
  }

  // --- 7) Блок инициализации при загрузке страницы ---
  (async function init() {
    await loadTodayRates();      // получаем сегодня → заполняем select
    // сразу сделаем «перевести» для значения по умолчанию (NZD), 
    // чтобы результат и график появились сразу же при загрузке
    convertCurrency();
  })();
});
