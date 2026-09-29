/* 
  HTMX event listeners o funciones auxiliares pueden ir aqui.
*/

// Script para auto-completar las barras (/) y validar en los campos de fecha
document.addEventListener('input', function (e) {
    const camposFecha = ['fecha_nacimiento', 'fecha_inicio', 'fecha_fin', 'nueva_fecha_fin'];
    if (e.target && camposFecha.includes(e.target.name)) {
        let val = e.target.value.replace(/\D/g, ''); 
        if (val.length > 8) val = val.substring(0, 8);
        
        // Validación lógica de Día y Mes
        let isValid = true;
        if (val.length >= 2) {
            const dia = parseInt(val.substring(0, 2), 10);
            if (dia < 1 || dia > 31) isValid = false;
        }
        if (val.length >= 4) {
            const mes = parseInt(val.substring(2, 4), 10);
            if (mes < 1 || mes > 12) isValid = false;
        }
        if (val.length >= 8) {
            const anio = parseInt(val.substring(4, 8), 10);
            const currentYear = new Date().getFullYear();
            if (e.target.name === 'fecha_nacimiento') {
                if (anio < 1900 || anio > currentYear) isValid = false;
            } else {
                // Fechas de partes de enfermo (actuales o futuras)
                if (anio < 2020 || anio > 2100) isValid = false;
            }
        }

        const errorMsg = e.target.parentElement.querySelector('#fecha-error') || e.target.parentElement.querySelector('.fecha-error');
        if (errorMsg) {
            if (!isValid) {
                errorMsg.classList.remove('hidden');
                e.target.classList.add('border-red-500', 'bg-red-50', 'dark:bg-red-950/40');
            } else {
                errorMsg.classList.add('hidden');
                e.target.classList.remove('border-red-500', 'bg-red-50', 'dark:bg-red-950/40');
            }
        }

        // Insertar las barras automáticamente
        if (val.length > 4) {
            e.target.value = val.substring(0, 2) + '/' + val.substring(2, 4) + '/' + val.substring(4, 8);
        } else if (val.length > 2) {
            e.target.value = val.substring(0, 2) + '/' + val.substring(2, 4);
        } else {
            e.target.value = val;
        }
    }
});
