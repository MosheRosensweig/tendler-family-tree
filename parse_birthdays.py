import csv
import re

FALLBACK_DATA = """Saba (Moshe David Tendler) and Savta (Shifra/Sifra Feinstein)
1. Rivky and Shabtai Rappaport
   1. Hodiya Ita and Yonatan Hainovitz
      * Hadarelle Dina Sima and Matanya Gnatek
      * Menachem Mendel Shaul Ariel
      * Hillel
      * Gavriel
      * Sara Tzion Shifra
   2. Miriam Chana and Tzvika Reinstein
      * Eliya and Bat El (Katan)
         1. Stav
         2. Dror Nachum
      * Shaul Ori and Roni (Goldberg)
      * Eitan Yaakov and Menuchah (Chaimov?)
      * Aviad
   3. Shmuel and Avigayil (Ki-Tov)
      * Ayala and Yehoshua Tunik
         1. Hodaya
         2. Moshe 
         3. Malachi
      * Sima and Natan Perlow 
         1. David
         2. Hallel
         3. Shlomo 
      * Shaul
      * Chana
      * Eliyahu
      * Sara
      * Shifra
      * Yisroel Meir
      * Tehila
      * Orah
      * Ovadya Yosef
   4. Hadassah Elisheva and Shuki (Yehoshua) Meirson
      * Tal Or Bracha
      * Noga Oriya
      * Noam Matityahu
      * Sara Shifra
      * Aron Simcha
      * Milka Devora Sima 
      * Adi Ahava
   5. Bella Atara and Michael Shlomi
      *  Malachy Yehuda
      * Yair
      * Asaf Chai
      * Shachar Mevaser
      * Ziv Moshe 
   6. Ruti (Rut Tehila) and Noach Kunin
      * Michael Yaacov
      * Shifra Ahava
      * Yona Yitzchak
      * Chaya Carmel
   7. Yitzchak Issac and Eliana Rachel (Tanenbaum)
      * Naftali Ariel
      * Shifra Shira
      * Oriya Nechama
      * Shaul Amichai
      * Noam Shalom
      * Aryeh Lavi
      * Kaila Tzion 
   8. Yisrael Shalom and Rivky (Roth)
      * Rimon Malka
      * Dvash
      * Mayim
      * Eretz Yonah
   9. Shauli
   10. Shimi (Shima Shalomtzion Simcha) and Uriya Dvir
      * Imri
      * Yarden Jenya
2. Yacov and Yael (Geffen)
   1. Aron and Tiffany (Rothenberg)
      * Maribel Miriam 
   2. Fia and Avi Leibowitz
      * Shoshana Chaya and Ashi Bersin
         1. Chava Esther
         2. Hadassah Baila
         3. Golda Malka
         4. Moshe Dov
      * Ahuva and Yehuda Greenberg 
         1. Leora Sima 
      * Meir Simcha and Aleeza (Weiss)
         1. Kayla Devora 
      * Shmuel
      * Tzipporah and Ezriel Valt
      * Yehoshua Benzion
   3. Avraham Shimon and Chanie (Ovitz)
      * Akiva
      * Shifra Hadas
      * Ester Rimon
      * Yitzchak Eliyahu
      * Talia Devora
   4. Bella and Dovid Kreiger
      * Jetta Pearl
      * Sienna Rose/ Sima Chana
      * Olivia Patrice/Luba Shifra
   5. Shlomo and Sarah (Sebbag)
      * Ayden Eliyahu
      * Ilan Chai
   6. Esther and Avi Bohorodzaner
      * Ava Shifra
      * Jamie/ Chaim Meir
      * Sima Liel
      * Yitzchak Moshe 
   7. Tuvia and Kelila (Kahane)
      * Emil Sifra/ Amalia Shifra
      * Theodora Eve (Thea), Adira Chaya
3. Mordecai and Michelle (Jofen)
   1. Leah and Shlomo Charner
      * Sima and Moishy Slasky
         1. Dina
         2. Chana Devora 
         3. Natan Tzvi
      * Chaya Miriam and Shlomo Zalman Fox 
      * Yakov Chaim
      * Yocheved
      * Shifra
      * Tuvia
      * Esther Batsheva
   2. Rachel and Avi Rosner
      * Shlomo Menachem and Chani (Heimowitz)
      * Sarah Leah
      * Yosef Efraim
      * Yocheved
      * Yitzchak
      * Tzvi
      * Nechama
   3. Bella Shoshana and Moshe Kaufman
      * Simi and Yehuda Neuwirth
         1. Shifra 
         2. Elka Bluma 
      * Faigy
      * Yocheved
      * Shifra
      * Avrami (Avraham Chaim)
      * Yaakov
      * Ahron
      * Yisroel
   4. Rivka and Yehoshua Recht
      * Tzvi (Menashe Tzvi)
      * Shifra
      * Yosef Peretz
      * Liba  (Liba Ahuva)
      * Yocheved
      * (Fruma) Chana 
   5. Sara and Elchanan Shoff
      * Shifra
      * Estee (Esther Faiga)
      * Yocheved
      * Yaakov Chaim
      * Fraida Golda (Goldi)
      * Chaya Leah
      * Moshe Dovid 
   6. Tzipporah and Zev Shub
      * Shifra
      * Yeshaya Avraham
      * Yocheved
      * Chaim Ahron 
      * Sima Basya
   7. Ariella and Meir Schiller
      * Yaakov Chaim
      * Aliza Leah
      * Shifra Bella
      * Rachel Chaya
      * Moshe Dovid
   8. Aharon Yosef and Shaindy (Lerner)
      * Dina 
      * Devora Raizel
      * Moshe Dovid 
4. Aron Boruch and Esther Tzipora (Shapiro)
   1. Naomi and Yirachmiel Goldman
      *  Sima Ariella and Moshe Dovid Cohen
         1. Sara malka
         2. Shoshana Bella  
      * Chaim Zev
      * Shifra Gittel
      * Shalom Eliyahu
      * Yisrael Yosef
   2. Yitzchak and Elisheva (Eis)
      * Chava Kayla and Elisha Kreitenberg
      * Ezra Chaim
      * Shifra Sara
      * Hadasa Morielle
      * Mordecai Hillel
   3. Dina and Avraham Groll
      * Chaim Tudres
      * Miriam Chaya
      * Shifra Leah
      * Atara Hadassa
      * Tehilla Menucha 
   4. Shoshana and Yitz Warn
      * Chaim Zev
      * Sara Hadassah
      * Shifra Bella 
   5. Elisheva and Dany Donaty
      * Meir Rachamim
      * Chaim Netanel
      * Moshe Dovid 
      * Baby girl 
5. Hillel and Mashie (Hechtman)
   1. Zevi and Sarah (Frenkel)
      * Shmuel Yitzy
      * Shifra
      * Tehila
      * Esther Batya (Esti)
      * Yosef Yehuda (Yossi)
   2. Sholom Chaim and Rivky (Gruman)
      * Yaakov
      * Miriam And Dovid Bender
      * Shifra
      * Rochel
      * Sara
      * Yitzchok Aryeh 
      * Batsheva 
   3. Aron Gershon and Naomi (Spetner)
      * Yehuda
      * Shifra
      * Tziporah
      * Yitzy
      * Yossi
      * Yehudis
      * Yechiel
      * Eliezer
      * Chana
      * Aryeh Mordechai
      * Moshe Dovid  
   4. Eli and Shulamis (Brickman)
      * Shifra
      * Simi
      * Gavriel
      * Baruch
      * Moshe Dovid 
   5. Yitzi and Nechama (Lieder)
      * Yehudah
      * Shifrah
      * Raizel Miriam 
      * Zev
      * Margalit Chana
   6. Rikki and Ephraim Davis
      * Shifra
      * Shmuel
      * Yitzchak Aryeh
      * Chava Sarah
      * Shoshana Rela 
   7. Shlomo and Sarala (Gold)
      * Devorah
      * Shifra
      * Avraham (Abie)
      * Shalva
      * Sima 
   8. Yacov and Rivka (Berger)
      * Binyamin Tzvi
      * Yitzchok Aryeh
      * Esther
   9. Simi and Michoel Nussbaum
      * Shifra Ahuva
      * Yitzchok Aryeh
      * Esther  
   10. Tamari and Moishie Goldenberg
      * Shifra 
      * Aryeh Mayer 
6. Sara and Avraham Oren
   1. Bella Renana and Yosef Krumbein
      * Noam Shimon
      * Tamar Shifra
      * Amitai Shlomo
      * Moshe Shalom
   2. Chana Golda and Tovia Ben-Dovid
      * Maayan Shifra
      * Yishai Michael
      * Yehudah Dov
      * Tal Batya
      * Moshe
      * Lavie Aharon  
   3. Chaim and Hagit (Zigler)
      * Hodaya
      * Ori Shifra
      * Hallel
      * Elad Moshe  
   4. Rachel and Elchanan Schwartz
      * Yuval Shifra
      * Shoham Tova
      * Tomer Baruch
   5. Yechiel Mordechai and Dafna (Ben Harush) Oren-Harush
      * Akiva Yitzchak 
   6. Simma and Avraham Shrem
      * David Ori 
   7. Yaakov Shalom and Leah Paley
   8. Tehilla Rivka and Sagi Gefen
      * Maor Ariel 
   9. Leah Avital and Ariel Ishon 
   10. Mass'et Shoshana
7. Russi and Sholom Fried
   1. Leah and Eitan Bitter
      * Bella Sophia (Baila Tzipporah)
      * Moriya Chaya (Maya)
   2. Yosef and Tamar (Feldstein)
      * Devora Rivka (Rivky)
      * Yitzchak Isaac (Yitzy)
      * Yaakov Koppel 
      * Baila
   3. Yitzchak Isaac
   4. Sima 
   5. Rachel Fraidel and Moshe Rosensweig
      * Miriam Shifra 
      * Chayim Betzalel
8. Eli and Racheli (Schonkopf)
   1. Yossi and Yehudis (Pollak)
      * Malca
      * Yitzchak Isaac
      * Avraham Pinchos
      * Moshe Dovid
      * Avigdor 
   2. Ari and Elky (Hoffman)
      * Kayla Hadassah
      * Blima Esther (Rosie)
      * Basya
   3. Sima and Zevi Kazarnovsky
      * Shifra
      * Chana
      * Moshe Dovid 
   4. Leora and Yakov Jacobowitz
      * Moshe Dovid 
      * Avraham 
   5. Yitzy"""

def get_indent(line):
    return len(line) - len(line.lstrip())

def parse_line_content(text, parent_last):
    text = text.strip()
    text = re.sub(r'^\d+\.\s*', '', text)
    text = re.sub(r'^\*\s*', '', text).strip()
    
    # Root check
    if 'Saba' in text and 'Savta' in text:
        m = re.search(r'Saba\s*\(([^)]+)\)\s*and\s*Savta\s*\(([^)]+)\)', text, re.IGNORECASE)
        if m:
            n1 = m.group(1).strip().split(' ')
            n2 = m.group(2).strip().split(' ')
            return {
                'is_couple': True,
                'spouse1': {'first_name': ' '.join(n1[:-1]), 'last_name': n1[-1]},
                'spouse2': {'first_name': ' '.join(n2[:-1]), 'last_name': n2[-1]},
                'family_last': n1[-1]
            }

    # Couple check
    couple_m = re.match(r'^(.+?)\s+[Aa]nd\s+(.+)$', text)
    if couple_m:
        n1 = couple_m[1].strip()
        n2 = couple_m[2].strip()
        
        maiden = None
        maiden_m = re.match(r'^(.+?)\s*\(([^)]+)\)\s*$', n2)
        if maiden_m:
            n2 = maiden_m[1].strip()
            maiden = maiden_m[2].strip()
            
        words2 = n2.split(' ')
        if not maiden and len(words2) > 1 and not words2[-1].startswith('('):
            fam_last = words2[-1]
            first2 = ' '.join(words2[:-1])
            return {
                'is_couple': True,
                'spouse1': {'first_name': n1, 'last_name': fam_last},
                'spouse2': {'first_name': first2, 'last_name': fam_last},
                'family_last': fam_last
            }
        else:
            sp2_last = maiden if maiden else parent_last
            return {
                'is_couple': True,
                'spouse1': {'first_name': n1, 'last_name': parent_last},
                'spouse2': {'first_name': n2, 'last_name': sp2_last},
                'family_last': parent_last
            }
            
    # Single
    return {
        'is_couple': False,
        'person': {'first_name': text, 'last_name': parent_last},
        'family_last': parent_last
    }

def build_tree_records(data_str):
    lines = [l for l in data_str.split('\n') if l.strip()]
    records = []
    stack = [(-1, 'Tendler')]
    
    for line in lines:
        indent = get_indent(line)
        while stack and stack[-1][0] >= indent:
            stack.pop()
        
        parent_last = stack[-1][1] if stack else 'Tendler'
        parsed = parse_line_content(line, parent_last)
        
        if parsed['is_couple']:
            records.append(parsed['spouse1'])
            records.append(parsed['spouse2'])
            stack.append((indent, parsed['family_last']))
        else:
            records.append(parsed['person'])
            stack.append((indent, parsed['family_last']))
            
    return records

records = build_tree_records(FALLBACK_DATA)

csv_path = '/Users/mosherosensweig/GIT/tendler-family-tree/birthdays.csv'
tsv_path = '/Users/mosherosensweig/GIT/tendler-family-tree/birthdays.tsv'

headers = ['Last Name ', 'First Name ', 'Birthday Date (spell out month to avoid confusion)']

with open(csv_path, 'w', newline='', encoding='utf-8') as f:
    writer = csv.writer(f)
    writer.writerow(headers)
    for r in records:
        writer.writerow([r['last_name'], r['first_name'], ''])

with open(tsv_path, 'w', newline='', encoding='utf-8') as f:
    writer = csv.writer(f, delimiter='\t')
    writer.writerow(headers)
    for r in records:
        writer.writerow([r['last_name'], r['first_name'], ''])

print(f"Successfully generated {len(records)} entries in CSV and TSV.")
