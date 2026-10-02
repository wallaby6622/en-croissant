import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import be_BY from "./be-BY.json";
import de_DE from "./de-DE.json";
import en_GB from "./en-GB.json";
import en_US from "./en-US.json";
import es_ES from "./es-ES.json";
import fr_FR from "./fr-FR.json";
import it_IT from "./it-IT.json";
import ko_KR from "./ko-KR.json";
import nb_NO from "./nb-NO.json";
import pl_PL from "./pl-PL.json";
import pt_PT from "./pt-PT.json";
import ru_RU from "./ru-RU.json";
import tr_TR from "./tr-TR.json";
import uk_UA from "./uk-UA.json";
import zh_CN from "./zh-CN.json";
import zh_TW from "./zh-TW.json";
import LanguageDetector from "i18next-browser-languagedetector";

i18n.use(LanguageDetector)
    .use(initReactI18next)
    .init({
        resources: {
            "en-US": en_US,
            "en-GB": en_GB,
            "pt-PT": pt_PT,
            "zh-CN": zh_CN,
            "ru-RU": ru_RU,
            "uk-UA": uk_UA,
            "be-BY": be_BY,
            "nb-NO": nb_NO,
            "pl-PL": pl_PL,
            "es-ES": es_ES,
            "it-IT": it_IT,
            "fr-FR": fr_FR,
            "tr-TR": tr_TR,
            "ko-KR": ko_KR,
            "zh-TW": zh_TW,
            "de-DE": de_DE,
        },
        detection: {
            order: ["localStorage"],
            caches: ["localStorage"],
        },
        fallbackLng: "en-US",
        returnEmptyString: false,
    });
