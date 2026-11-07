# Komut satırı ve aracılar

Her kurulum, pencerenin kullandığı motorların aynısını süren bir `hermesoffice` komutuyla gelir — aynı ayrıştırıcılar, aynı yazıcı, aynı işleyici. Uygulamanın kaydettiği dosya ile komutun yazdığı dosya aynı dosyadır ve uygulamanın AI panelinin geçtiği bir denetimden komut da geçer.

```sh
hermesoffice --help          # every command
hermesoffice guide slides    # the op reference, for writing your own
```

Tüm yüzey tek ekranda budur — her komut ne yaptığını söyleyen bir satırla, ardından genel seçenekler ve çıkış kodları:

![hermesoffice --help komutunun gerçek çıktısı: sürüm başlığı, tek satırlık açıklamasıyla her komut, genel seçenekler ve çıkış kodları](img/cli.png)

## Komutu edinme

macOS ve Windows komutu uygulama paketinin içinde sunar. Adıyla kullanmak için bir kez `hermesoffice install-cli` çalıştırın: paketli ikili dosyayı PATH'inizdeki bir dizine bağlar — macOS'ta Homebrew öneki olmayan `/usr/local/bin` dizinine (Homebrew'un kendi dizinlerine asla dokunulmaz), aksi halde kullanıcı bin dizininize — ya da Windows'ta kullanıcı `PATH`'inize.

## Bilinmeye değer komutlar

| Komut             | Ne yapar                                                                                                                                                                                                         |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `open`            | Bir belgeyi uygulamada açar; uygulama çalışmıyorsa başlatır.                                                                                                                                                     |
| `selection`       | Uygulama çalışırken kullanıcının o dosyada şu anda ne seçtiği — "bu" / "burası" için işaretçi. Dosyanın bulunduğu düzenleyiciye göre bir blok aralığı, bir sayfa aralığı, slayt öğeleri veya bir sayfa döndürür. |
| `convert`         | Uygulamanın kendi motorlarını kullanarak biçimler arasında dönüştürür.                                                                                                                                           |
| `create`          | Yapılandırılmış içerikten bir belge oluşturur.                                                                                                                                                                   |
| `render`          | İşleyicinin yerleştirdiği gibi sayfa başına bir PNG.                                                                                                                                                             |
| `pdf`             | Bir PDF'nin metin katmanını sayfa sayfa, uygulama süreci olmadan okur.                                                                                                                                           |
| `info`            | Bir belgenin meta verileri ve yapı özeti.                                                                                                                                                                        |
| `search`          | Uygulamada yapılandırılan sağlayıcı üzerinden web veya görsel araması.                                                                                                                                           |
| `image` / `media` | Bir görsel oluşturur ya da bir görsel, video veya ses dosyasını betimler ve hakkında soru yanıtlar.                                                                                                              |
| `merge`           | Bir `.docx`, `.pptx` veya `.xlsx` şablonundaki `{{key}}` yer tutucularını doldurur.                                                                                                                              |
| `capabilities`    | Bu makinede hangi bulut özelliklerinin yapılandırıldığını bildirir.                                                                                                                                              |
| `guide`           | Op başvurusu ve tasarım kılavuzları; yürütücünün doğruladığı tanımların aynısından üretilir — bu yüzden `apply` komutunun kabul ettiğinden sapamaz. `--json` her op'un şemasıyla birlikte döndürür.              |
| `install-cli`     | `hermesoffice` komutunu `PATH`'e ekler.                                                                                                                                                                          |
| `skill`           | Bu makinede bulunan kodlama aracılarını listeler ve HermesOffice becerisini bunlara kurar ya da günceller.                                                                                                       |
| `mcp`             | Her komutu bir Model Context Protocol aracı olarak sunar. Bkz. **Bir kodlama aracısı bağlama**.                                                                                                                  |

## Düzenleme: docs, sheets, slides

`hermesoffice docs`, `hermesoffice sheet` ve `hermesoffice slides` komutlarının her biri önce bir alt komut alır — `read`, `apply`, `check` ve slides için `audit`, `render`, `replace` — ve uygulamanın kullandığı yazma yolundan geçer. Ortak bir sözcük dağarcığı paylaşırlar: bir **op** tek bir düzenlemedir, bir **spec** ise sırayla uygulanan op listesidir.

```sh
hermesoffice sheet read report.xlsx
hermesoffice slides apply deck.pptx --ops ops.json --dry-run
hermesoffice docs apply brief.docx --ops ops.json
```

`--dry-run` bir toplu işin ne yapacağını bildirir ve hiçbir şey yazmaz; bir spec'i yerine oturmadan önce denetlemenin ucuz yolu budur. Uygulamadaki AI paneli tam olarak bu op'lar üzerinde çalışır, dolayısıyla ondan isteyebildiğiniz her şeyi betikleyebilirsiniz.

## Model Context Protocol

`hermesoffice mcp` her komutu bir MCP aracı olarak sunar ve `hermesoffice mcp install <agent|all>` bunu bir kodlama aracısının kendi yapılandırmasına kaydeder. O taraf için bkz. **Bir kodlama aracısı bağlama**.

## Komutun yapmadıkları

Dosyayı okur ve yazar. Uygulama değildir: pencere yoktur ve uygulama içi güncelleme iletişim kutusu geçerli değildir. Pencereye ihtiyaç duyan her şey — AI paneli, işlenmiş bir slayt üzerindeki kalite denetimi — dosyayı açmanızı beklemek zorundadır. `hermesoffice render` pikselleri pencere olmadan verir ve `hermesoffice slides` bir sununun düzenini kendi başına denetler.
